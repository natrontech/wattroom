// Package tokens is ADR-0015's personal read tokens: created and revoked on
// the profile, stored as SHA-256 only, accepted as bearer auth solely for
// reads of the owner's own data.
package tokens

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const maxTokensPerUser = 10 // plenty for one rider's agents; caps abuse

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
	mux.HandleFunc("POST /api/tokens", s.handleCreate)
	mux.HandleFunc("GET /api/tokens", s.handleList)
	mux.HandleFunc("DELETE /api/tokens/{id}", s.handleDelete)
}

// FromRequest resolves a bearer token to its owner; used by /mcp and the
// GET-only bearer path. Returns false for anything but a live token.
func (s *Service) FromRequest(r *http.Request) (db.User, bool) {
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || !strings.HasPrefix(raw, "wrt_") {
		return db.User{}, false
	}
	hash := sha256.Sum256([]byte(raw))
	user, err := s.store.Queries.GetUserByTokenHash(r.Context(), hash[:])
	if err != nil {
		return db.User{}, false
	}
	// Best-effort freshness signal for the profile list; never blocks auth.
	if err := s.store.Queries.TouchToken(r.Context(), hash[:]); err != nil {
		s.log.Warn("token touch failed", "err", err)
	}
	return user, true
}

// ReadSource wraps a cookie source so bearer tokens also authenticate — GET
// only, so a token can never write (ADR-0015).
func (s *Service) ReadSource(cookie UserSource) UserSource {
	return readSource{cookie: cookie, tokens: s}
}

type readSource struct {
	cookie UserSource
	tokens *Service
}

func (rs readSource) User(r *http.Request) (db.User, bool) {
	if user, ok := rs.cookie.User(r); ok {
		return user, true
	}
	if r.Method != http.MethodGet {
		return db.User{}, false
	}
	return rs.tokens.FromRequest(r)
}

type tokenJSON struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
	Token      string `json:"token,omitempty"` // only ever set at creation
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
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
			"A token name has to be 1-60 characters.", "name")
		return
	}
	existing, err := s.store.Queries.ListUserTokens(r.Context(), user.ID)
	if err != nil {
		s.log.Error("token list failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Tokens could not be loaded.")
		return
	}
	if len(existing) >= maxTokensPerUser {
		httpx.WriteError(w, http.StatusConflict, "conflict",
			"Ten tokens is the cap — revoke one you no longer use first.")
		return
	}

	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		s.log.Error("token entropy failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The token could not be created.")
		return
	}
	raw := "wrt_" + hex.EncodeToString(secret)
	hash := sha256.Sum256([]byte(raw))
	row, err := s.store.Queries.CreateToken(r.Context(), db.CreateTokenParams{
		UserID: user.ID, Name: req.Name, TokenHash: hash[:],
	})
	if err != nil {
		s.log.Error("token create failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The token could not be created.")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, tokenJSON{
		ID: store.UUIDString(row.ID), Name: req.Name,
		CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
		Token:     raw, // the one and only time it leaves the server
	})
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	rows, err := s.store.Queries.ListUserTokens(r.Context(), user.ID)
	if err != nil {
		s.log.Error("token list failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Tokens could not be loaded.")
		return
	}
	out := make([]tokenJSON, 0, len(rows))
	for _, row := range rows {
		entry := tokenJSON{
			ID: store.UUIDString(row.ID), Name: row.Name,
			CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
		}
		if row.LastUsedAt.Valid {
			entry.LastUsedAt = row.LastUsedAt.Time.Format(time.RFC3339)
		}
		out = append(out, entry)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": out})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such token.")
		return
	}
	n, err := s.store.Queries.DeleteToken(r.Context(), db.DeleteTokenParams{ID: id, UserID: user.ID})
	if err != nil {
		s.log.Error("token delete failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The token could not be revoked.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such token.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
