// Package friends is ADR-0012 made small: mutual friendship formed only
// by exchanging friend codes, presence that never pierces the room boundary.
// The server stores who is friends with whom; "where they are" is answered
// live from the hub and persisted nowhere.
package friends

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource resolves the signed-in user — same shape rooms consumes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// PresenceSource answers "which room is this user connected to right now" —
// defined here where it is consumed, implemented by the hub.
type PresenceSource interface {
	WhereIs(userIDs []string) map[string]string
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
	mux.HandleFunc("GET /api/friends", s.handleList)
	mux.HandleFunc("POST /api/friends", s.handleRequest)
	mux.HandleFunc("POST /api/friends/{id}/accept", s.handleAccept)
	mux.HandleFunc("DELETE /api/friends/{id}", s.handleDelete)
}

type friendJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Avatar + lifetime XP (#253) — same facts the rooms roster shows.
	AvatarURL    *string `json:"avatarUrl,omitempty"`
	AvatarPreset *string `json:"avatarPreset,omitempty"`
	TotalXp      int64   `json:"totalXp"`
	// accepted | pending_in (they asked me) | pending_out (I asked them)
	Status string `json:"status"`
	// Presence — accepted friends only (ADR-0012). Online means "app open"
	// (the lobby socket, #251 — Slack's green dot), InRoom that they are in
	// some room, and the room is named ONLY when the viewer is a member of it.
	Online   bool   `json:"online,omitempty"`
	InRoom   bool   `json:"inRoom,omitempty"`
	Room     string `json:"room,omitempty"` // slug
	RoomName string `json:"roomName,omitempty"`
}

// handleList is the whole panel in one GET: friends with presence, plus my
// own friend code — the thing I hand out so people can ask me.
func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListFriendships(r.Context(), me.ID)
	if err != nil {
		s.log.Error("list friendships", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your friends could not be loaded.")
		return
	}

	accepted := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.Status == "accepted" {
			accepted = append(accepted, store.UUIDString(row.ID))
		}
	}
	where := s.presence.WhereIs(accepted)

	// Hoisted out of the per-friend loop (#687): collect every distinct room
	// slug an online friend is in, resolve them all in one query, then check
	// the viewer's membership in every one of those rooms in a second query.
	// 1 + 2N queries becomes 3, regardless of how many friends are online.
	slugSet := make(map[string]struct{}, len(where))
	for _, slug := range where {
		if slug != "" {
			slugSet[slug] = struct{}{}
		}
	}
	roomsBySlug := make(map[string]db.Room, len(slugSet))
	memberOf := make(map[pgtype.UUID]struct{}, len(slugSet))
	if len(slugSet) > 0 {
		slugs := make([]string, 0, len(slugSet))
		for slug := range slugSet {
			slugs = append(slugs, slug)
		}
		roomList, err := s.store.Queries.GetRoomsBySlugs(r.Context(), slugs)
		if err != nil {
			s.log.Error("get rooms by slugs", "err", err, "user", store.UUIDString(me.ID))
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your friends could not be loaded.")
			return
		}
		roomIDs := make([]pgtype.UUID, 0, len(roomList))
		for _, room := range roomList {
			roomsBySlug[room.Slug] = room
			roomIDs = append(roomIDs, room.ID)
		}
		if len(roomIDs) > 0 {
			memberships, err := s.store.Queries.ListMembershipsForUser(r.Context(), db.ListMembershipsForUserParams{
				UserID: me.ID, RoomIds: roomIDs,
			})
			if err != nil {
				s.log.Error("list memberships for user", "err", err, "user", store.UUIDString(me.ID))
				httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your friends could not be loaded.")
				return
			}
			for _, m := range memberships {
				memberOf[m.RoomID] = struct{}{}
			}
		}
	}

	friends := make([]friendJSON, 0, len(rows))
	for _, row := range rows {
		entry := friendJSON{
			ID: store.UUIDString(row.ID), Name: row.DisplayName,
			AvatarURL: row.AvatarUrl, AvatarPreset: row.AvatarPreset,
			TotalXp: row.TotalXp,
		}
		switch {
		case row.Status == "accepted":
			entry.Status = "accepted"
			// Present in the map = online (lobby socket); a value names the room.
			slug, online := where[entry.ID]
			entry.Online = online
			entry.InRoom = slug != ""
			if slug != "" {
				// The room is named only for its own members — the boundary holds.
				if room, ok := roomsBySlug[slug]; ok {
					if _, ok := memberOf[room.ID]; ok {
						entry.Room = slug
						entry.RoomName = room.Name
					}
				}
			}
		case row.RequesterID == me.ID:
			entry.Status = "pending_out"
		default:
			entry.Status = "pending_in"
		}
		friends = append(friends, entry)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"friends": friends, "code": me.FriendCode})
}

func (s *Service) handleRequest(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var body struct {
		Code string `json:"code"`
		// A rider's page (ADR-0024) asks by id — allowed only across a
		// shared room, so the code itself never has to travel.
		UserID string `json:"userId"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "Send a JSON body with a friend code or a rider id.")
		return
	}
	var target pgtype.UUID
	if body.UserID != "" {
		id, err := store.ParseUUID(body.UserID)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a rider id.")
			return
		}
		if id == me.ID {
			httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That would be you.")
			return
		}
		// The room is the formation gate here (ADR-0012's original rule): no
		// room in common, no request — and no confirmation that the id exists.
		shared, err := s.store.Queries.ListRoomsInCommon(r.Context(), db.ListRoomsInCommonParams{Rider: id, Viewer: me.ID})
		if err != nil || len(shared) == 0 {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "No rider there that you share a room with — ask them for their code instead.")
			return
		}
		target = id
	} else {
		// The formation gate (ADR-0012 amendment): knowing someone's code IS
		// the permission to ask them.
		code := strings.ToUpper(strings.TrimSpace(body.Code))
		if code == "" {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Enter a friend code.", "code")
			return
		}
		user, err := s.store.Queries.GetUserByFriendCode(r.Context(), code)
		if err != nil {
			httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "No rider has that code — double-check it with them.", "code")
			return
		}
		if user.ID == me.ID {
			httpx.WriteFieldError(w, http.StatusBadRequest, "invalid_request", "That is your own code.", "code")
			return
		}
		target = user.ID
	}
	err := s.store.Queries.CreateFriendRequest(r.Context(), db.CreateFriendRequestParams{
		RequesterID: me.ID, AddresseeID: target,
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		httpx.WriteError(w, http.StatusConflict, "conflict", "There is already a request or friendship with them.")
		return
	}
	if err != nil {
		s.log.Error("create friend request", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The request could not be sent.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleAccept(w http.ResponseWriter, r *http.Request) {
	me, target, ok := s.pair(w, r)
	if !ok {
		return
	}
	// Only the addressee accepts — target is the requester here.
	n, err := s.store.Queries.AcceptFriendRequest(r.Context(), db.AcceptFriendRequestParams{
		RequesterID: target, AddresseeID: me.ID,
	})
	if err != nil {
		s.log.Error("accept friend request", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The request could not be accepted.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No pending request from them.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	me, target, ok := s.pair(w, r)
	if !ok {
		return
	}
	// Cancel, dismiss, or unfriend — the same silent act (ADR-0012).
	n, err := s.store.Queries.DeleteFriendship(r.Context(), db.DeleteFriendshipParams{
		RequesterID: me.ID, AddresseeID: target,
	})
	if err != nil {
		s.log.Error("delete friendship", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That could not be removed.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "You are not connected to them.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// pair does the boundary work every mutating handler shares: auth, a valid
// target id, and target-is-not-me.
func (s *Service) pair(w http.ResponseWriter, r *http.Request) (db.User, pgtype.UUID, bool) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.User{}, pgtype.UUID{}, false
	}
	target, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a user id.")
		return db.User{}, pgtype.UUID{}, false
	}
	if target == me.ID {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That would be you.")
		return db.User{}, pgtype.UUID{}, false
	}
	return me, target, true
}
