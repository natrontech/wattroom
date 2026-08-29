// Package rooms is persistent rooms (#17): create, join via link or code,
// roles per the docs/SPEC.md matrix. Durable data only — everything live
// (ticks, timers, presence) stays in the hub (#18).
package rooms

import (
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource is what rooms needs from auth — defined here, where it is
// consumed, and satisfied by *auth.Service.
type UserSource interface {
	User(r *http.Request) (db.User, bool)
}

type Service struct {
	store *store.Store
	users UserSource
	log   *slog.Logger
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/rooms", s.handleCreate)
	mux.HandleFunc("GET /api/rooms", s.handleMine)
	mux.HandleFunc("POST /api/rooms/join", s.handleJoinByCode)
	mux.HandleFunc("GET /api/rooms/{slug}", s.handleGet)
	mux.HandleFunc("PATCH /api/rooms/{slug}", s.handleUpdate)
	mux.HandleFunc("POST /api/rooms/{slug}/join", s.handleJoin)
	mux.HandleFunc("POST /api/rooms/{slug}/role", s.handleSetRole)
	mux.HandleFunc("DELETE /api/rooms/{slug}/members/{userID}", s.handleRemoveMember)
}

// --- responses ---

type memberJSON struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	Role        string  `json:"role"`
}

type roomJSON struct {
	Slug   string `json:"slug"`
	Code   string `json:"code,omitempty"` // members only — the code IS the invite
	Name   string `json:"name"`
	Listed bool   `json:"listed"`
	// The caller's own role; empty when they are not a member.
	Role    string       `json:"role,omitempty"`
	Members []memberJSON `json:"members,omitempty"`
}

// --- handlers ---

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Sign in to create a room.")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A room name has to be 1-60 characters.", "name")
		return
	}

	// Slug and code both need uniqueness; retry on collision rather than
	// checking first — the constraint is the check.
	var room db.Room
	for attempt := 0; ; attempt++ {
		slug := slugify(req.Name)
		if attempt > 0 {
			slug += "-" + randomCode(4)
		}
		created, err := s.store.Queries.CreateRoom(r.Context(), db.CreateRoomParams{
			Code: randomCode(6), Slug: strings.ToLower(slug), Name: req.Name, OwnerID: user.ID,
		})
		if err == nil {
			room = created
			break
		}
		if isUniqueViolation(err) && attempt < 3 {
			continue
		}
		s.log.Error("room create failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return
	}

	err := s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "owner",
	})
	if err != nil {
		s.log.Error("owner membership failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, roomJSON{
		Slug: room.Slug, Code: room.Code, Name: room.Name, Listed: room.Listed, Role: "owner",
	})
}

func (s *Service) handleMine(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	roomsList, err := s.store.Queries.ListUserRooms(r.Context(), user.ID)
	if err != nil {
		s.log.Error("list rooms failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your rooms could not be loaded.")
		return
	}
	out := make([]roomJSON, 0, len(roomsList))
	for _, room := range roomsList {
		out = append(out, roomJSON{Slug: room.Slug, Name: room.Name, Listed: room.Listed})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rooms": out})
}

// handleGet renders differently by membership: members get everything (the
// code is the invite, so it stays inside the room); anyone else with the link
// gets just enough to decide to join. Metrics privacy is not at stake here —
// nothing live crosses this endpoint.
func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	response := roomJSON{Slug: room.Slug, Name: room.Name, Listed: room.Listed}

	if user, signedIn := s.users.User(r); signedIn {
		if m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
			RoomID: room.ID, UserID: user.ID,
		}); err == nil {
			response.Role = m.Role
			response.Code = room.Code
			members, err := s.store.Queries.ListRoomMembers(r.Context(), room.ID)
			if err != nil {
				s.log.Error("list members failed", "err", err, "room", room.Slug)
				httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be loaded.")
				return
			}
			for _, member := range members {
				response.Members = append(response.Members, memberJSON{
					ID: store.UUIDString(member.ID), DisplayName: member.DisplayName,
					AvatarURL: member.AvatarUrl, Role: member.Role,
				})
			}
		}
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

func (s *Service) handleJoin(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Sign in to join a room.")
		return
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	// Idempotent by design (ON CONFLICT DO NOTHING): joining twice is a no-op,
	// and an existing role is never downgraded to member by a re-join.
	err := s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "member",
	})
	if err != nil {
		s.log.Error("join failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleJoinByCode resolves a 6-char code to its room and joins — the
// cross-device fallback when the link is on another screen.
func (s *Service) handleJoinByCode(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Sign in to join a room.")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	room, err := s.store.Queries.GetRoomByCode(r.Context(), code)
	if err != nil {
		// Same shape for "no such code" and lookup errors: a code is a secret,
		// and this endpoint must not confirm which ones exist.
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found",
			"No room has that code. Check it with whoever shared it.", "code")
		return
	}
	err = s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "member",
	})
	if err != nil {
		s.log.Error("join by code failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"slug": room.Slug})
}

// handleUpdate: owner-only per the matrix — "Edit room (name, listing)".
func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	_ = user
	var req struct {
		Name   string `json:"name"`
		Listed bool   `json:"listed"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A room name has to be 1-60 characters.", "name")
		return
	}
	updated, err := s.store.Queries.UpdateRoom(r.Context(), db.UpdateRoomParams{
		ID: room.ID, Name: req.Name, Listed: req.Listed,
	})
	if err != nil {
		s.log.Error("room update failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, roomJSON{
		Slug: updated.Slug, Code: updated.Code, Name: updated.Name, Listed: updated.Listed, Role: "owner",
	})
}

// handleSetRole: owner assigns or removes coach (matrix: owner-only).
func (s *Service) handleSetRole(w http.ResponseWriter, r *http.Request) {
	room, owner, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	var req struct {
		UserID string `json:"userId"`
		Role   string `json:"role"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if req.Role != "coach" && req.Role != "member" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A role is coach or member — ownership does not transfer here.", "role")
		return
	}
	target, err := store.ParseUUID(req.UserID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a user id.", "userId")
		return
	}
	if store.UUIDString(target) == store.UUIDString(owner.ID) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"You are the owner — that role does not change here.")
		return
	}
	err = s.store.Queries.UpdateMembershipRole(r.Context(), db.UpdateMembershipRoleParams{
		RoomID: room.ID, UserID: target, Role: req.Role,
	})
	if err != nil {
		s.log.Error("role update failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The role could not be changed.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRemoveMember: the owner removes anyone; anyone removes themselves
// (leaving). The owner cannot leave — a room without an owner has nobody who
// can edit or delete it, so ownership transfer is a future feature, not an
// accident of leaving.
func (s *Service) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	target, err := store.ParseUUID(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That is not a user id.")
		return
	}

	self := store.UUIDString(target) == store.UUIDString(user.ID)
	if !self {
		if _, _, ok := s.requireRole(w, r, "owner"); !ok {
			return
		}
	}
	if room.OwnerID == target {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"The owner cannot leave their own room.")
		return
	}
	err = s.store.Queries.DeleteMembership(r.Context(), db.DeleteMembershipParams{
		RoomID: room.ID, UserID: target,
	})
	if err != nil {
		s.log.Error("remove member failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That did not work. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

func (s *Service) roomBySlug(w http.ResponseWriter, r *http.Request) (db.Room, bool) {
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), strings.ToLower(r.PathValue("slug")))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No room lives at this link.")
		return db.Room{}, false
	}
	if err != nil {
		s.log.Error("room lookup failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be loaded.")
		return db.Room{}, false
	}
	return room, true
}

// requireRole loads the room and refuses unless the caller holds the role.
// 403, not 404: the link is shareable, so the room's existence is not a secret.
func (s *Service) requireRole(w http.ResponseWriter, r *http.Request, role string) (db.Room, db.User, bool) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return db.Room{}, db.User{}, false
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return db.Room{}, db.User{}, false
	}
	m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: user.ID,
	})
	if err != nil || m.Role != role {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the room's "+role+" can do that.")
		return db.Room{}, db.User{}, false
	}
	return room, user, true
}

// randomCode draws from an alphabet with no 0/O/1/I/L — codes get read out
// loud across a room over trainer noise.
func randomCode(length int) string {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failing means the platform is broken
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	slug := nonSlug.ReplaceAllString(strings.ToLower(name), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "room"
	}
	if len(slug) > 40 {
		slug = slug[:40]
	}
	return slug
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
