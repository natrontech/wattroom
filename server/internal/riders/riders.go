// Package riders is a rider's page (ADR-0024): what rooms already see —
// name, level, energy, medals from rooms you share, where they are — plus,
// for friends, the rides the rider chose to share. Never live watts, heart
// rate, weight or FTP; those stay room-scoped. Strangers get a 404: without
// a shared room or a friendship there is no page.
package riders

import (
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// maxSharedRides caps the activity list: a page, not an export.
const maxSharedRides = 50

type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// PresenceSource is what the page borrows from the hub: which room the rider
// is connected to, and whether they are riding in it. Live state, persisted
// nowhere — same two questions the friends list and the rail already ask.
type PresenceSource interface {
	WhereIs(userIDs []string) map[string]string
	Presence(slug string) protocol.RoomPresence
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

// handleAvatar serves a rider's uploaded picture (#1353) to anyone signed in:
// the face is what every roster, thread and friends list already shows, so it
// carries none of the page's shared-room gate.
func (s *Service) handleAvatar(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Sign in to see a rider's picture."); !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a rider id.")
		return
	}
	img, err := s.store.Queries.GetUserAvatar(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such picture.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "avatar read failed", err, "The picture could not be loaded.", "rider", r.PathValue("id"))
		return
	}
	httpx.ServeImage(w, r, img.Mime, img.Image, img.SetAt.Time)
}

type roomRef struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// presenceJSON follows the friends list (ADR-0012): online is the lobby
// socket, inRoom that they are in some room, and the room is named only when
// the viewer is a member of it. A room-mate who is not a friend sees only
// the shared rooms — the same thing the roster already shows them.
type presenceJSON struct {
	Online bool     `json:"online"`
	InRoom bool     `json:"inRoom"`
	Riding bool     `json:"riding"`
	Room   *roomRef `json:"room,omitempty"`
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
	// Ridden in a room; named only when the viewer is a member of it.
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
	// docs/SPEC.md kind → count, scoped to rooms in common.
	Medals        map[string]int64 `json:"medals"`
	RoomsInCommon []roomRef        `json:"roomsInCommon"`
	Presence      presenceJSON     `json:"presence"`
	// self | none | pending_in | pending_out | accepted — the friends list's
	// own vocabulary, so one page can offer Accept as well as Add.
	Friend string `json:"friend"`
	// The viewer may ask: they share a room and nothing is pending. The
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
	// One message for "no such rider" and "not yours to see": a 404 must not
	// confirm that an id exists.
	const notVisible = "No rider there — a page shows only to people who share a room or a friendship with them."
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
	rooms, err := s.store.Queries.ListRoomsInCommon(ctx, db.ListRoomsInCommonParams{Rider: id, Viewer: me.ID})
	if err != nil {
		s.fail(w, "rooms in common", err, me)
		return
	}
	friend, err := s.friendStatus(r, me, rider)
	if err != nil {
		s.fail(w, "friendship", err, me)
		return
	}
	// pending_out is not a door: a code grants "may ask", not "may look".
	if friend == "none" || friend == "pending_out" {
		if len(rooms) == 0 {
			httpx.WriteError(w, http.StatusNotFound, "not_found", notVisible)
			return
		}
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
	inCommon := make([]roomRef, 0, len(rooms))
	for _, room := range rooms {
		inCommon = append(inCommon, roomRef{Slug: room.Slug, Name: room.Name})
	}

	out := riderJSON{
		ID: store.UUIDString(rider.ID), DisplayName: rider.DisplayName,
		AvatarURL: rider.AvatarUrl,
		Since:     rider.CreatedAt.Time.Format(time.RFC3339),
		TotalXp:   totals.TotalXp, TotalKj: totals.TotalKj, Rides: totals.Rides,
		Medals: medals, RoomsInCommon: inCommon,
		Friend: friend, CanAdd: friend == "none",
	}
	trusted := friend == "self" || friend == "accepted"
	out.Presence = s.presenceOf(rider, inCommon, trusted)

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

// presenceOf answers "where are they" within the boundary: a friend (or the
// rider) gets online/in-a-room like the friends list; a room-mate only learns
// about rooms in common, which the roster shows them anyway.
func (s *Service) presenceOf(rider db.User, inCommon []roomRef, trusted bool) presenceJSON {
	var p presenceJSON
	if s.presence == nil {
		return p
	}
	id := store.UUIDString(rider.ID)
	slug, online := s.presence.WhereIs([]string{id})[id]
	shared := slices.IndexFunc(inCommon, func(room roomRef) bool { return room.Slug == slug })
	if slug != "" && shared >= 0 {
		room := inCommon[shared]
		p.Room = &room
		// By id (#649): display names are not unique, and two Dans in one
		// room both showed the bars while one sat in the lounge (#1652).
		p.Riding = slices.Contains(s.presence.Presence(slug).RidingIDs, id)
	}
	if trusted {
		p.Online = online
		p.InRoom = slug != ""
	} else {
		p.Online = p.Room != nil
		p.InRoom = p.Room != nil
	}
	return p
}

func (s *Service) fail(w http.ResponseWriter, what string, err error, me db.User) {
	httpx.Fail(w, s.log, "rider page: "+what, err, "That rider's page could not be loaded.", "user", store.UUIDString(me.ID))
}

