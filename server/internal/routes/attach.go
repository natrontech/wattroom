package routes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Attacher puts a workout's road on it, cut to whoever is reading (#3051,
// ADR-0063). A workout stores only a reference to its route; this is the one
// place the road itself is read out for a workout, so it is the one place
// the audience rule has to hold.
type Attacher struct {
	q    *db.Queries
	keys *secrets.Cipher
}

// NewAttacher reads routes through q, and opens their sealed roads with keys
// (#3511) — nil on a server with no key, which keeps bare roads only.
func NewAttacher(q *db.Queries, keys *secrets.Cipher) *Attacher { return &Attacher{q: q, keys: keys} }

// Refused is a road a workout may not take where others read it, in words
// for the rider who tried.
type Refused string

func (r Refused) Error() string { return string(r) }

// Unasked is a route its owner has not said yes to sharing with a crew
// listed in the directory (#4149, ADR-0063 "A listed crew asks first"), in
// the words the owner is asked. A client asks, PUTs the answer to
// /api/routes/{id}/crews/{crew}, and tries again: a session's pick reads
// ConsentCode, a plan's refusal the field "consent".
type Unasked string

func (u Unasked) Error() string { return string(u) }

// ConsentCode is a session's refusal of an Unasked route.
const ConsentCode = "consent_forbidden"

// asked holds a route back from a crew listed in the directory until its
// owner has said yes for that crew: anyone can walk into such a crew, and
// the road it rides redraws the route.
func (a *Attacher) asked(ctx context.Context, route, crew pgtype.UUID) error {
	row, err := a.q.CrewRouteAsk(ctx, db.CrewRouteAskParams{RouteID: route, CrewID: crew})
	if err != nil {
		return fmt.Errorf("routes: read crew %s's answer: %w", store.UUIDString(crew), err)
	}
	if row.Listed && !row.Shared {
		return Unasked("Anyone who joins " + row.Name + " will see this route.")
	}
	return nil
}

// crewOf is the crew a session's channel belongs to.
func (a *Attacher) crewOf(ctx context.Context, channel string) (pgtype.UUID, error) {
	// A crew session names its crew (docs/SESSIONS.md).
	if crew, ok := protocol.CrewOfPlace(channel); ok {
		return store.ParseUUID(crew)
	}
	id, err := store.ParseUUID(channel)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("routes: channel %q is not an id: %w", channel, err)
	}
	ch, err := a.q.GetChannel(ctx, id)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("routes: read channel %s: %w", channel, err)
	}
	return ch.CrewID, nil
}

// attached is the road a reader gets: the reference, and the profile cut
// for them — packed as $lib/road's packRoad writes it, base64 on the wire —
// starting originM metres along the owner's road. Deleted says the route is
// gone, and nothing else is there.
type attached struct {
	workout.RoadRef
	Profile string  `json:"profile,omitempty"`
	OriginM float64 `json:"originM"`
	// The owner's whole road ends where it began (#4257): a workout on it
	// laps, as $lib/workout/road-workout reads it. A cut never does.
	Loop    bool `json:"loop,omitempty"`
	Deleted bool `json:"deleted,omitempty"`
}

// CheckShared is the write rule for a workout others will read — a plan, a
// session's pick (#3051): its road must be the actor's own route, not one
// from Strava, which rides owner-only, and, if crew is listed in the
// directory, one its owner said yes to sharing with crew (ADR-0063). It
// answers the route the workout names, invalid when it names none.
func (a *Attacher) CheckShared(ctx context.Context, workoutJSON string, actor, crew pgtype.UUID) (pgtype.UUID, error) {
	ref, err := workout.RoadOf(workoutJSON)
	if err != nil || ref == nil {
		return pgtype.UUID{}, err
	}
	// WattRoom's own roads ride with anyone, and no route row backs them.
	if _, ok := fromLibrary(ref.RouteID); ok {
		return pgtype.UUID{}, nil
	}
	id, err := store.ParseUUID(ref.RouteID)
	if err != nil {
		return pgtype.UUID{}, Refused("A workout's road names no route.")
	}
	row, err := a.q.GetRouteRoad(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && row.OwnerID != actor {
		return pgtype.UUID{}, Refused("That route is not yours to ride with others — only its owner can put it in a plan or a session.")
	}
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("routes: read road %s: %w", ref.RouteID, err)
	}
	if row.Src == stravaSrc {
		return pgtype.UUID{}, Refused("Routes from Strava ride with you alone, never in a plan or a session.")
	}
	if err := a.asked(ctx, id, crew); err != nil {
		return pgtype.UUID{}, err
	}
	return id, nil
}

// SharedName is the name a workout goes out under wherever someone besides
// its route's owner may read it (#3055, ADR-0063): a workout on a road is
// named by the route's generated name — the owner's rename can say where
// they live, and it stays on the owner's own reads. A workout on no road
// keeps its name, and so does one whose route is gone, since the app named
// it from the generated name in the first place.
func (a *Attacher) SharedName(ctx context.Context, workoutJSON, name string) (string, error) {
	return SharedName(ctx, a.q, workoutJSON, name)
}

// SharedName is Attacher.SharedName for a caller holding only the queries: a
// name needs no road, so no key.
//
// It reads the route leniently, unlike RoadOf: a client uploads the copy it
// was handed — a session's tick or its own library, with the cut attached —
// and that copy names the same route.
func SharedName(ctx context.Context, q *db.Queries, workoutJSON, name string) (string, error) {
	var w struct {
		Road *struct {
			RouteID string `json:"routeId"`
		} `json:"road"`
	}
	if json.Unmarshal([]byte(workoutJSON), &w) != nil || w.Road == nil {
		return name, nil
	}
	if lib, ok := fromLibrary(w.Road.RouteID); ok {
		return lib.name, nil
	}
	id, err := store.ParseUUID(w.Road.RouteID)
	if err != nil {
		return name, nil
	}
	gen, err := q.GetRouteGenName(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return name, nil
	}
	if err != nil {
		return "", fmt.Errorf("routes: read name of %s: %w", w.Road.RouteID, err)
	}
	return gen, nil
}

// CheckOwn is the write rule for a rider's own library: the road must be one
// of their routes, Strava's included — nobody else ever reads it.
func (a *Attacher) CheckOwn(ctx context.Context, workoutJSON string, owner pgtype.UUID) error {
	ref, err := workout.RoadOf(workoutJSON)
	if err != nil || ref == nil {
		return err
	}
	if _, ok := fromLibrary(ref.RouteID); ok {
		return nil
	}
	id, err := store.ParseUUID(ref.RouteID)
	if err != nil {
		return Refused("A workout's road names no route.")
	}
	row, err := a.q.GetRouteRoad(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && row.OwnerID != owner {
		return Refused("That route is not one of yours.")
	}
	return err
}

// Attach returns the workout with its road cut for viewer (ADR-0063): the
// whole road when the route is theirs; for anyone else the stretch between
// its anchors — RouteHiddenEndM in from each end until the geo pack draws
// zones — with heights relative to where it starts, so neither the ends it
// hides nor an altitude that would place it leaves. A workout with no road
// comes back as it was, and one whose route is gone says so.
func (a *Attacher) Attach(ctx context.Context, workoutJSON string, viewer pgtype.UUID) (string, error) {
	ref, err := workout.RoadOf(workoutJSON)
	if err != nil || ref == nil {
		return workoutJSON, err
	}
	out := attached{RoadRef: *ref}
	lib, inLibrary := fromLibrary(ref.RouteID)
	var row db.GetRouteRoadRow
	if !inLibrary {
		id, perr := store.ParseUUID(ref.RouteID)
		if perr != nil {
			return workoutJSON, perr
		}
		row, err = a.q.GetRouteRoad(ctx, id)
	}
	switch {
	case inLibrary:
		// Invented, so whole for everyone, and a loop as it was made.
		out.Loop = true
		out.Profile = base64.StdEncoding.EncodeToString(lib.road.Pack())
	case errors.Is(err, pgx.ErrNoRows):
		out.Deleted = true
	case err != nil:
		return workoutJSON, fmt.Errorf("routes: read road %s: %w", ref.RouteID, err)
	default:
		// The crew's cut carries headings, so it is cut from the whole road;
		// a seal this key will not open leaves the bare one, which still rides
		// (the owner's read logs it).
		whole, err := WholeRoad(a.keys, row.Road, row.RoadSealed, row.KeyVersion)
		if err != nil {
			whole = row.Road
		}
		ridden, err := road.UnpackRoad(whole)
		if err != nil {
			return workoutJSON, fmt.Errorf("routes: stored road %s unreadable: %w", ref.RouteID, err)
		}
		if row.OwnerID != viewer {
			ridden, out.OriginM = ridden.Cut(protocol.RouteHiddenEndM, ridden.LengthM-protocol.RouteHiddenEndM)
		} else {
			out.Loop = row.Loop != nil && *row.Loop
		}
		if len(ridden.Heights) > 1 {
			packed := ridden.Pack()
			if len(packed) > protocol.MaxAttachedRoadBytes {
				return workoutJSON, fmt.Errorf("routes: road %s packs to %d bytes", ref.RouteID, len(packed))
			}
			out.Profile = base64.StdEncoding.EncodeToString(packed)
		}
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(workoutJSON), &fields); err != nil {
		return workoutJSON, err
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return workoutJSON, err
	}
	fields["road"] = raw
	joined, err := json.Marshal(fields)
	return string(joined), err
}

// SessionRoute is the road a session rides (#3095): the coach's own route,
// never one from Strava, described as everyone in the channel rides it — the
// crew's cut between the anchors, under its generated name — with that cut's
// heights for the hub's bunch (#3028), and never its turns. A route that is
// not the coach's reads as absent, as it does everywhere else. One the coach
// has not shared with channel's crew, if it is listed, is refused with
// ConsentCode; channel "" is a plan's start, asked when it was planned.
func (a *Attacher) SessionRoute(ctx context.Context, coach, routeID, channel string) (protocol.SessionRoute, road.Road, *protocol.Error, error) {
	owner, err := store.ParseUUID(coach)
	if err != nil {
		return protocol.SessionRoute{}, road.Road{}, nil, fmt.Errorf("routes: coach %q is not an id: %w", coach, err)
	}
	if lib, ok := fromLibrary(routeID); ok {
		return protocol.SessionRoute{ID: routeID, Hash: lib.hash, GenName: lib.name, LengthM: lib.road.LengthM, Loop: true},
			road.Road{LengthM: lib.road.LengthM, Heights: lib.road.Heights}, nil, nil
	}
	id, err := store.ParseUUID(routeID)
	if err != nil {
		return protocol.SessionRoute{}, road.Road{}, nil, fmt.Errorf("routes: route %q is not an id: %w", routeID, err)
	}
	row, err := a.q.GetOwnerRoute(ctx, db.GetOwnerRouteParams{ID: id, OwnerID: owner})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return protocol.SessionRoute{}, road.Road{}, &protocol.Error{Code: "not_found", Message: "That route is not one of yours."}, nil
	case err != nil:
		return protocol.SessionRoute{}, road.Road{}, nil, fmt.Errorf("routes: read route %s: %w", routeID, err)
	case row.Src == stravaSrc:
		return protocol.SessionRoute{}, road.Road{}, &protocol.Error{Code: "forbidden", Message: "Routes from Strava ride with you alone, never in a session."}, nil
	}
	if channel != "" {
		crew, err := a.crewOf(ctx, channel)
		if err == nil {
			err = a.asked(ctx, id, crew)
		}
		var unasked Unasked
		if errors.As(err, &unasked) {
			return protocol.SessionRoute{}, road.Road{}, &protocol.Error{Code: ConsentCode, Message: string(unasked)}, nil
		}
		if err != nil {
			return protocol.SessionRoute{}, road.Road{}, nil, err
		}
	}
	ridden, err := road.UnpackRoad(row.Road)
	if err != nil {
		return protocol.SessionRoute{}, road.Road{}, nil, fmt.Errorf("routes: stored road %s unreadable: %w", routeID, err)
	}
	cut, from := ridden.Cut(protocol.RouteHiddenEndM, ridden.LengthM-protocol.RouteHiddenEndM)
	if len(cut.Heights) < 2 {
		return protocol.SessionRoute{}, road.Road{}, &protocol.Error{Code: "validation_error",
			Message: "This route is too short to ride together: its first and last kilometre stay with you."}, nil
	}
	return protocol.SessionRoute{ID: routeID, Hash: row.RoadHash, GenName: row.GenName, LengthM: cut.LengthM, CutFromM: from},
		road.Road{LengthM: cut.LengthM, Heights: cut.Heights}, nil, nil
}

// CrewRoute is the session route a workout's road asks for (#3103): its
// route from the workout's first metre, counted along the crew's cut rather
// than the owner's road — the owner's metres less the hidden end the cut
// leaves out, and never past the cut's last sample. Nil when the workout
// rides no road, or its route is gone.
func (a *Attacher) CrewRoute(ctx context.Context, workoutJSON string) (*protocol.ControlRoute, error) {
	ref, err := workout.RoadOf(workoutJSON)
	if err != nil || ref == nil {
		return nil, err
	}
	// No hidden ends on WattRoom's own roads: the crew's metres are the road's.
	if lib, ok := fromLibrary(ref.RouteID); ok {
		return &protocol.ControlRoute{ID: ref.RouteID, FromM: min(max(ref.FromM, 0), lib.road.LengthM-lib.road.Step()), Loop: true}, nil
	}
	id, err := store.ParseUUID(ref.RouteID)
	if err != nil {
		return nil, fmt.Errorf("routes: route %q is not an id: %w", ref.RouteID, err)
	}
	row, err := a.q.GetRouteRoad(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("routes: read road %s: %w", ref.RouteID, err)
	}
	ridden, err := road.UnpackRoad(row.Road)
	if err != nil {
		return nil, fmt.Errorf("routes: stored road %s unreadable: %w", ref.RouteID, err)
	}
	cut, origin := ridden.Cut(protocol.RouteHiddenEndM, ridden.LengthM-protocol.RouteHiddenEndM)
	if len(cut.Heights) < 2 {
		return nil, nil
	}
	return &protocol.ControlRoute{ID: ref.RouteID, FromM: min(max(ref.FromM-origin, 0), cut.LengthM-cut.Step())}, nil
}

// ForSession is a session's pick in channel (#3051): the coach's own route,
// never one from Strava, and one shared with the channel's crew if it is
// listed, attached as the crew's cut for every socket in the channel — the
// coach's included, since one workout rides the tick to all of them.
func (a *Attacher) ForSession(ctx context.Context, coach, channel, workoutJSON string) (string, string, error) {
	id, err := store.ParseUUID(coach)
	if err != nil {
		return "", "", fmt.Errorf("routes: coach %q is not an id: %w", coach, err)
	}
	if ref, _ := workout.RoadOf(workoutJSON); ref != nil {
		if _, ok := fromLibrary(ref.RouteID); ok {
			attached, err := a.Attach(ctx, workoutJSON, pgtype.UUID{})
			return attached, "", err
		}
	}
	crew, err := a.crewOf(ctx, channel)
	if err != nil {
		return "", "", err
	}
	if _, err := a.CheckShared(ctx, workoutJSON, id, crew); err != nil {
		var refused Refused
		var unasked Unasked
		if errors.As(err, &refused) {
			return "", string(refused), nil
		}
		if errors.As(err, &unasked) {
			return "", string(unasked), nil
		}
		return "", "", err
	}
	attached, err := a.Attach(ctx, workoutJSON, pgtype.UUID{})
	return attached, "", err
}
