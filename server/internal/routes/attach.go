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
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Attacher puts a workout's road on it, cut to whoever is reading (#3051,
// ADR-0063). A workout stores only a reference to its route; this is the one
// place the road itself is read out for a workout, so it is the one place
// the audience rule has to hold.
type Attacher struct {
	q *db.Queries
}

// NewAttacher reads routes through q.
func NewAttacher(q *db.Queries) *Attacher { return &Attacher{q: q} }

// Refused is a road a workout may not take where others read it, in words
// for the rider who tried.
type Refused string

func (r Refused) Error() string { return string(r) }

// attached is the road a reader gets: the reference, and the profile cut
// for them — packed as $lib/road's packRoad writes it, base64 on the wire —
// starting originM metres along the owner's road. Deleted says the route is
// gone, and nothing else is there.
type attached struct {
	workout.RoadRef
	Profile string  `json:"profile,omitempty"`
	OriginM float64 `json:"originM"`
	Deleted bool    `json:"deleted,omitempty"`
}

// CheckShared is the write rule for a workout others will read — a plan, a
// session's pick (#3051): its road must be the actor's own route, and not
// one from Strava, which rides owner-only (ADR-0063). It answers the route
// the workout names, invalid when it names none.
func (a *Attacher) CheckShared(ctx context.Context, workoutJSON string, actor pgtype.UUID) (pgtype.UUID, error) {
	ref, err := workout.RoadOf(workoutJSON)
	if err != nil || ref == nil {
		return pgtype.UUID{}, err
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
	return id, nil
}

// CheckOwn is the write rule for a rider's own library: the road must be one
// of their routes, Strava's included — nobody else ever reads it.
func (a *Attacher) CheckOwn(ctx context.Context, workoutJSON string, owner pgtype.UUID) error {
	ref, err := workout.RoadOf(workoutJSON)
	if err != nil || ref == nil {
		return err
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
	id, err := store.ParseUUID(ref.RouteID)
	if err != nil {
		return workoutJSON, err
	}
	row, err := a.q.GetRouteRoad(ctx, id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		out.Deleted = true
	case err != nil:
		return workoutJSON, fmt.Errorf("routes: read road %s: %w", ref.RouteID, err)
	default:
		ridden, err := road.UnpackRoad(row.Road)
		if err != nil {
			return workoutJSON, fmt.Errorf("routes: stored road %s unreadable: %w", ref.RouteID, err)
		}
		if row.OwnerID != viewer {
			ridden, out.OriginM = ridden.Cut(protocol.RouteHiddenEndM, ridden.LengthM-protocol.RouteHiddenEndM)
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
// not the coach's reads as absent, as it does everywhere else.
func (a *Attacher) SessionRoute(ctx context.Context, coach, routeID string) (protocol.SessionRoute, road.Road, *protocol.Error, error) {
	owner, err := store.ParseUUID(coach)
	if err != nil {
		return protocol.SessionRoute{}, road.Road{}, nil, fmt.Errorf("routes: coach %q is not an id: %w", coach, err)
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
	ridden, err := road.UnpackRoad(row.Road)
	if err != nil {
		return protocol.SessionRoute{}, road.Road{}, nil, fmt.Errorf("routes: stored road %s unreadable: %w", routeID, err)
	}
	cut, _ := ridden.Cut(protocol.RouteHiddenEndM, ridden.LengthM-protocol.RouteHiddenEndM)
	return protocol.SessionRoute{ID: routeID, Hash: row.RoadHash, GenName: row.GenName, LengthM: cut.LengthM},
		road.Road{LengthM: cut.LengthM, Heights: cut.Heights}, nil, nil
}

// ForSession is a session's pick (#3051): the coach's own route, never one
// from Strava, attached as the crew's cut for every socket in the channel —
// the coach's included, since one workout rides the tick to all of them.
func (a *Attacher) ForSession(ctx context.Context, coach, workoutJSON string) (string, string, error) {
	id, err := store.ParseUUID(coach)
	if err != nil {
		return "", "", fmt.Errorf("routes: coach %q is not an id: %w", coach, err)
	}
	if _, err := a.CheckShared(ctx, workoutJSON, id); err != nil {
		var refused Refused
		if errors.As(err, &refused) {
			return "", string(refused), nil
		}
		return "", "", err
	}
	attached, err := a.Attach(ctx, workoutJSON, pgtype.UUID{})
	return attached, "", err
}
