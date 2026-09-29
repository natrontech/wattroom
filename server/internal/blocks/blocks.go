// Package blocks is "Hide this rider" (#3202, ADR-0012 amended 2026-09-29):
// a block that works both ways. Hiding someone closes the DM thread, takes
// the friendship off both lists, and keeps each rider's friend requests,
// cheers, pokes and reactions from the other. It never parts a crew — a
// shared channel's sessions, voice and live numbers are the crew ban's.
//
// The blocked rider is never told. Everything they could notice is an
// answer they already get elsewhere: a DM refused as a closed thread is, a
// friend request left pending, a friend who reads as unfriended.
//
// The SQL gates (`rider_hidden`, `friendship_visible`) do the HTTP half. The
// live half — cheers and pokes sorted per socket on the tick — reads the
// in-memory copy here, since a query per frame is not an option.
package blocks

import (
	"context"
	"log/slog"
	"net/http"
	"sync"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource resolves the signed-in user — same shape friends consumes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Pinger is the lobby ping: both riders' friends lists and DM heads change,
// and every open panel refetches rather than waiting for its poll.
type Pinger interface {
	PresenceChanged()
}

// Service owns the rider_blocks rows and the hub's copy of them.
//
// ponytail: every pair in one map, loaded at boot. Fine far past this
// server's riders; per-socket sets filled at connect if it ever is not.
type Service struct {
	store    *store.Store
	users    UserSource
	presence Pinger
	log      *slog.Logger

	mu    sync.RWMutex
	pairs map[[2]string]struct{} // {blocker, blocked}
}

func New(st *store.Store, users UserSource, presence Pinger, log *slog.Logger) *Service {
	return &Service{store: st, users: users, presence: presence, log: log,
		pairs: make(map[[2]string]struct{})}
}

// Load fills the in-memory copy from the table, once, before the first room
// opens.
func (s *Service) Load(ctx context.Context) error {
	rows, err := s.store.Queries.ListAllHiddenPairs(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, row := range rows {
		s.pairs[[2]string{store.UUIDString(row.BlockerID), store.UUIDString(row.BlockedID)}] = struct{}{}
	}
	return nil
}

// Hidden reports whether either rider has hidden the other.
func (s *Service) Hidden(a, b string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ab := s.pairs[[2]string{a, b}]
	_, ba := s.pairs[[2]string{b, a}]
	return ab || ba
}

func (s *Service) set(blocker, blocked pgtype.UUID, on bool) {
	key := [2]string{store.UUIDString(blocker), store.UUIDString(blocked)}
	s.mu.Lock()
	defer s.mu.Unlock()
	if on {
		s.pairs[key] = struct{}{}
	} else {
		delete(s.pairs, key)
	}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/blocks", s.handleList)
	mux.HandleFunc("POST /api/blocks", s.handleHide)
	mux.HandleFunc("DELETE /api/blocks/{id}", s.handleUnhide)
}

type hiddenJSON struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
	Since     int64   `json:"since"`
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListHiddenRiders(r.Context(), me.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list hidden riders", err, "Your hidden riders could not be loaded.", "user", store.UUIDString(me.ID))
		return
	}
	out := make([]hiddenJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, hiddenJSON{ID: store.UUIDString(row.ID), Name: row.DisplayName,
			AvatarURL: row.AvatarUrl, Since: row.CreatedAt.Time.UnixMilli()})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"riders": out})
}

func (s *Service) handleHide(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var body struct {
		UserID string `json:"userId"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "Send a JSON body with the rider's id.")
		return
	}
	target, err := store.ParseUUID(body.UserID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a rider id.", "userId")
		return
	}
	if target == me.ID {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "You cannot hide yourself.", "userId")
		return
	}
	found, err := s.store.Queries.HideRider(r.Context(), db.HideRiderParams{Blocker: me.ID, Blocked: target})
	if err != nil {
		httpx.Fail(w, s.log, "hide rider", err, "They could not be hidden. Try again.", "user", store.UUIDString(me.ID))
		return
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No rider there.")
		return
	}
	s.set(me.ID, target, true)
	s.presence.PresenceChanged()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleUnhide(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	target, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a rider id.")
		return
	}
	n, err := s.store.Queries.UnhideRider(r.Context(), db.UnhideRiderParams{BlockerID: me.ID, BlockedID: target})
	if err != nil {
		httpx.Fail(w, s.log, "unhide rider", err, "They could not be shown again. Try again.", "user", store.UUIDString(me.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "You have not hidden them.")
		return
	}
	s.set(me.ID, target, false)
	s.presence.PresenceChanged()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
