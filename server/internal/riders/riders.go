// Package riders is a rider's page (ADR-0024): what crew-mates already see —
// name, level, energy, medals from crews you share, where they are — plus,
// for friends, the rides the rider chose to share. Never live watts, heart
// rate, weight or FTP; those stay inside the session. Strangers get a 404:
// without a shared channel or a friendship there is no page — and, since
// #2239, no face either. Both routes here answer to one audience.
package riders

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/status"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// maxSharedRides caps the activity list: a page, not an export.
const maxSharedRides = 50

type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// PresenceSource is what the page borrows from the hub: which voice channel
// the rider is in, and whether they are riding in it. Live state, persisted
// nowhere — same two questions the friends list already asks.
type PresenceSource interface {
	WhereIs(userIDs []string) map[string]string
	// One question, one answer, everywhere it is asked (#1743): the friends
	// panel needs exactly this and used to have no way to ask, while this
	// page built the whole of a room's presence — voice fold, sort, session
	// state — to read one boolean out of it.
	Riding(userIDs []string) map[string]bool
}

type Service struct {
	store    *store.Store
	users    UserSource
	presence PresenceSource
	log      *slog.Logger
}

func New(st *store.Store, users UserSource, presence PresenceSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, presence: presence, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/riders/{id}", s.handleGet)
	mux.HandleFunc("GET /api/riders/{id}/avatar", s.handleAvatar)
}

// notVisible is one message for "no such rider" and "not yours to see": a 404
// must not confirm that an id exists. Shared by the page and the face below,
// so a refused caller cannot tell the two routes apart.
const notVisible = "No rider there — a page shows only to people who share a channel or a friendship with them."

// handleAvatar serves a rider's uploaded picture (#1353) to the page's own
// audience (ADR-0024, amended 2026-09-17 / #2239). It used to answer anyone
// signed in who held the id, on the reasoning that "the face is what every
// roster, thread and friends list already shows" — but ids travel where those
// surfaces do not: a chat backlog carries `fromId` for every author, so one
// room-mate could fetch the photograph of a rider who had long since left.
//
// The gate is the page's, asked the same way (#2300), and the refusal is the
// page's 404 word for word. That matters twice: it is the same answer an
// unknown id gets, so the route stops being the existence oracle handleGet
// declines to be, and it cannot drift from the page it belongs to.
func (s *Service) handleAvatar(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Sign in to see a rider's picture.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a rider id.")
		return
	}
	// Asked before the picture is looked up: the refusal must not depend on
	// whether the row exists, or the 404 tells the caller which 404 it is.
	mayLook, err := s.store.Queries.SharesChannelOrFriends(r.Context(), db.SharesChannelOrFriendsParams{
		Viewer: me.ID, Rider: id,
	})
	if err != nil {
		httpx.Fail(w, s.log, "avatar visibility", err, "The picture could not be loaded.", "user", store.UUIDString(me.ID))
		return
	}
	if !mayLook {
		httpx.WriteError(w, http.StatusNotFound, "not_found", notVisible)
		return
	}
	img, err := s.store.Queries.GetUserAvatar(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such picture.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "avatar read failed", err, "The picture could not be loaded.", "rider", store.UUIDString(id))
		return
	}
	httpx.ServeImage(w, r, img.Mime, img.Image, img.SetAt.Time)
}

type crewRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// presenceJSON follows the friends list (ADR-0012): online is the lobby
// socket, inVoice that they are in some voice channel, and the channel and
// its crew are named only when the viewer may enter it (ADR-0058). A
// crew-mate who is not a friend learns only about a channel they may enter
// themselves — who is in it is what its own page already shows them.
type presenceJSON struct {
	Online  bool            `json:"online"`
	InVoice bool            `json:"inVoice"`
	Riding  bool            `json:"riding"`
	Channel *channels.Place `json:"channel,omitempty"`
}

type monthJSON struct {
	Rides   int64 `json:"rides"`
	Seconds int64 `json:"seconds"`
	Kj      int64 `json:"kj"`
}

type sharedRideJSON struct {
	ID          string  `json:"id"`
	WorkoutName string  `json:"workoutName"`
	StartedAt   string  `json:"startedAt"`
	Seconds     int     `json:"seconds"`
	Kj          int     `json:"kj"`
	Execution   float64 `json:"execution"`
	// False when the workout prescribed nothing (#1143) — "0 % on target"
	// on a friend's page was a sprint session (audit 2026-09-09).
	ExecutionScored bool `json:"executionScored"`
	// docs/SPEC.md medal kinds won on this ride, if any.
	Medals []string `json:"medals,omitempty"`
	// Ridden with a crew; the voice channel is named only when the viewer
	// may enter it (ListSharedRides). The field names are the page's until
	// #2457.
	InRoom   bool   `json:"inRoom"`
	RoomName string `json:"roomName,omitempty"`
}

type riderJSON struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	// Account creation — "riding here since March 2026".
	Since string `json:"since"`
	// Lifetime sums: level derives from XP client-side (docs/SPEC.md).
	TotalXp int64 `json:"totalXp"`
	TotalKj int64 `json:"totalKj"`
	Rides   int64 `json:"rides"`
	// docs/SPEC.md kind → count, scoped to the crews in common.
	Medals        map[string]int64 `json:"medals"`
	CrewsInCommon []crewRef        `json:"crewsInCommon"`
	Presence      presenceJSON     `json:"presence"`
	// self | none | pending_in | pending_out | accepted — the friends list's
	// own vocabulary, so one page can offer Accept as well as Add.
	Friend string `json:"friend"`
	// Their own line (ADR-0060), which goes where the name goes; null for none.
	StatusLine *protocol.StatusLine `json:"statusLine"`
	// The viewer may ask: they share a channel and nothing is pending. The
	// friend code itself never travels — see friends.handleRequest.
	CanAdd bool `json:"canAdd"`
	// Friends (and the rider) only; null otherwise.
	Month       *monthJSON       `json:"month"`
	SharedRides []sharedRideJSON `json:"sharedRides"`
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Sign in to see a rider's page.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a rider id.")
		return
	}
	rider, err := s.store.Queries.GetUser(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", notVisible)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "rider lookup", err, "The rider's page could not be loaded. Try again.", "rider", store.UUIDString(id))
		return
	}
	ctx := r.Context()
	// ADR-0024's audience, asked as one question (#2298) — the same one the
	// trophy case on this page asks. It used to be recomposed here out of
	// ListRoomsInCommon and friendStatus, which agreed with the other gate by
	// coincidence and would have drifted the moment either rule moved.
	// "pending_out is not a door" lives in the query now: a code grants "may
	// ask", not "may look".
	mayLook, err := s.store.Queries.SharesChannelOrFriends(ctx, db.SharesChannelOrFriendsParams{
		Viewer: me.ID, Rider: id,
	})
	if err != nil {
		s.fail(w, "rider visibility", err, me)
		return
	}
	if !mayLook {
		httpx.WriteError(w, http.StatusNotFound, "not_found", notVisible)
		return
	}
	// The crews themselves are the page's content and the medals' scope, not
	// the gate.
	crews, err := s.store.Queries.ListCrewsInCommon(ctx, db.ListCrewsInCommonParams{Rider: id, Viewer: me.ID})
	if err != nil {
		s.fail(w, "crews in common", err, me)
		return
	}
	friend, err := s.friendStatus(r, me, rider)
	if err != nil {
		s.fail(w, "friendship", err, me)
		return
	}

	totals, err := s.store.Queries.RiderTotals(ctx, id)
	if err != nil {
		s.fail(w, "totals", err, me)
		return
	}
	medalRows, err := s.store.Queries.CountRiderMedalsInCommon(ctx, db.CountRiderMedalsInCommonParams{Rider: id, Viewer: me.ID})
	if err != nil {
		s.fail(w, "medals", err, me)
		return
	}
	medals := make(map[string]int64, len(medalRows))
	for _, row := range medalRows {
		medals[row.Kind] = row.Count
	}
	inCommon := make([]crewRef, 0, len(crews))
	for _, crew := range crews {
		inCommon = append(inCommon, crewRef{ID: store.UUIDString(crew.ID), Name: crew.Name})
	}

	out := riderJSON{
		ID: store.UUIDString(rider.ID), DisplayName: rider.DisplayName,
		AvatarURL: rider.AvatarUrl,
		Since:     rider.CreatedAt.Time.Format(time.RFC3339),
		TotalXp:   totals.TotalXp, TotalKj: totals.TotalKj, Rides: totals.Rides,
		Medals: medals, CrewsInCommon: inCommon,
		Friend: friend, CanAdd: friend == "none",
		StatusLine: status.OfUser(rider, time.Now()),
	}
	trusted := friend == "self" || friend == "accepted"
	if out.Presence, err = s.presenceOf(ctx, me, rider, trusted); err != nil {
		s.fail(w, "presence", err, me)
		return
	}

	if trusted {
		// The zone "this month" is counted in (#1653) is the rider's own —
		// stats.ZoneName, the same resolver the streak and the Load chart
		// use since #2063, so the four surfaces cannot drift apart again.
		month, err := s.store.Queries.RiderMonth(ctx, db.RiderMonthParams{
			UserID: id, Tz: stats.ZoneName(rider.Timezone),
		})
		if err != nil {
			s.fail(w, "month", err, me)
			return
		}
		out.Month = &monthJSON{Rides: month.Rides, Seconds: month.Seconds, Kj: month.Kj}
		shared, err := s.store.Queries.ListSharedRides(ctx, db.ListSharedRidesParams{
			Rider: id, Viewer: me.ID, Max: maxSharedRides,
		})
		if err != nil {
			s.fail(w, "shared rides", err, me)
			return
		}
		out.SharedRides = make([]sharedRideJSON, 0, len(shared))
		for _, row := range shared {
			out.SharedRides = append(out.SharedRides, sharedRideJSON{
				ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
				StartedAt: row.StartedAt.Time.Format(time.RFC3339),
				Seconds:   int(row.Seconds), Kj: int(row.Kj), Execution: float64(row.Execution),
				ExecutionScored: row.ExecutionScored,
				Medals:          strings.Fields(row.MedalKinds),
				InRoom:          row.InRoom, RoomName: row.RoomName,
			})
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// friendStatus resolves the pair to the friends list's vocabulary.
func (s *Service) friendStatus(r *http.Request, me, rider db.User) (string, error) {
	if rider.ID == me.ID {
		return "self", nil
	}
	row, err := s.store.Queries.GetFriendship(r.Context(), db.GetFriendshipParams{
		RequesterID: me.ID, AddresseeID: rider.ID,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "none", nil
	case err != nil:
		return "", err
	case row.Status == "accepted":
		return "accepted", nil
	case row.RequesterID == me.ID:
		return "pending_out", nil
	default:
		return "pending_in", nil
	}
}

// presenceOf answers "where are they" within the gate: a friend (or the
// rider) gets online/in-a-voice-channel like the friends list; a crew-mate
// only learns about a channel they may enter themselves, whose page shows
// them who is in it anyway.
func (s *Service) presenceOf(ctx context.Context, me, rider db.User, trusted bool) (presenceJSON, error) {
	var p presenceJSON
	if s.presence == nil {
		return p, nil
	}
	id := store.UUIDString(rider.ID)
	where := s.presence.WhereIs([]string{id})
	channel, online := where[id]
	places, err := channels.PlacesFor(ctx, s.store.Queries, me.ID, where)
	if err != nil {
		return p, err
	}
	if place, named := places[id]; named {
		p.Channel = &place
		// By id (#649): display names are not unique, and two Dans in one
		// room both showed the bars while one sat in the lounge (#1652).
		p.Riding = s.presence.Riding([]string{id})[id]
	}
	if trusted {
		p.Online = online
		p.InVoice = channel != ""
	} else {
		p.Online = p.Channel != nil
		p.InVoice = p.Channel != nil
	}
	return p, nil
}

func (s *Service) fail(w http.ResponseWriter, what string, err error, me db.User) {
	httpx.Fail(w, s.log, "rider page: "+what, err, "That rider's page could not be loaded.", "user", store.UUIDString(me.ID))
}
