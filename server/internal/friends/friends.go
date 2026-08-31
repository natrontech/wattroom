// Package friends is ADR-0012 made small: mutual friendship formed only
// through a shared room, presence that never pierces the room boundary.
// The server stores who is friends with whom; "where they are" is answered
// live from the hub and persisted nowhere.
package friends

import (
	"errors"
	"log/slog"
	"net/http"

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
	mux.HandleFunc("POST /api/friends/{id}", s.handleRequest)
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
	// Presence — accepted friends only (ADR-0012): a boolean, plus the room
	// ONLY when the viewer is a member of it.
	Online   bool   `json:"online,omitempty"`
	Room     string `json:"room,omitempty"` // slug
	RoomName string `json:"roomName,omitempty"`
}

type candidateJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// handleList is the whole panel in one GET: friends with presence, plus the
// roommates you could still ask (the only formation path).
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
			slug := where[entry.ID]
			entry.Online = slug != ""
			if slug != "" {
				// The room is named only for its own members — the boundary holds.
				if room, err := s.store.Queries.GetRoomBySlug(r.Context(), slug); err == nil {
					if _, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
						RoomID: room.ID, UserID: me.ID,
					}); err == nil {
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

	rawCandidates, err := s.store.Queries.ListFriendCandidates(r.Context(), me.ID)
	if err != nil {
		s.log.Error("list friend candidates", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your friends could not be loaded.")
		return
	}
	candidates := make([]candidateJSON, 0, len(rawCandidates))
	for _, c := range rawCandidates {
		candidates = append(candidates, candidateJSON{ID: store.UUIDString(c.ID), Name: c.DisplayName})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"friends": friends, "candidates": candidates})
}

func (s *Service) handleRequest(w http.ResponseWriter, r *http.Request) {
	me, target, ok := s.pair(w, r)
	if !ok {
		return
	}
	// The formation gate (ADR-0012): only roommates can be asked.
	shared, err := s.store.Queries.CountSharedRooms(r.Context(), db.CountSharedRoomsParams{
		UserID: me.ID, UserID_2: target,
	})
	if err != nil || shared == 0 {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only add people you share a room with.")
		return
	}
	err = s.store.Queries.CreateFriendRequest(r.Context(), db.CreateFriendRequestParams{
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
