// Package tokens is ADR-0017's personal read tokens: created and revoked on
// the profile, stored as SHA-256 only, accepted as bearer auth solely for
// reads of the owner's own data. A token the rider marked for planning
// (#4207) also lets MCP save workouts and plan sessions as them; the HTTP
// bearer path stays GET-only for every token.
package tokens

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const maxTokensPerUser = 10 // plenty for one rider's agents; caps abuse

// errTokenCap carries the ceiling out of the locked transaction: a refusal is
// not a database failure and must not be reported as one.
var errTokenCap = errors.New("tokens: per-account cap reached")

type UserSource interface {
	User(r *http.Request) (db.User, bool)
	// The one boundary every mutating handler resolves auth through
	// (auth.go): the Origin check on writes, and a 500 — not a 401 — when
	// the session lookup itself failed (audit 2026-09-09).
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Alarm is ADR-0030's security mail, told when a token is minted (#2811): a
// token outlives the session that made it, so a borrowed session's last move
// can be one, and only the owner can revoke it.
type Alarm interface {
	TokenMinted(user db.User)
}

type Service struct {
	store *store.Store
	users UserSource
	alarm Alarm
	log   *slog.Logger
}

func New(st *store.Store, users UserSource, alarm Alarm, log *slog.Logger) *Service {
	return &Service{store: st, users: users, alarm: alarm, log: log}
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

// CanWrite says whether the request's bearer is a token the rider marked for
// planning (#4207). Any failure reads as no: a write is never granted by an
// error.
func (s *Service) CanWrite(r *http.Request) bool {
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || !strings.HasPrefix(raw, "wrt_") {
		return false
	}
	hash := sha256.Sum256([]byte(raw))
	writes, err := s.store.Queries.TokenCanWrite(r.Context(), hash[:])
	return err == nil && writes
}

type actingKey struct{}

// Acting puts the owner of a planning token on a request MCP builds and
// serves in-process (#4207), so a write tool runs the very handler a rider's
// click does. Nothing outside the process can set a context value.
func Acting(ctx context.Context, user db.User) context.Context {
	return context.WithValue(ctx, actingKey{}, user)
}

// ActingSource wraps the cookie source of a service whose handlers MCP calls
// in-process: the rider Acting named is signed in, anything else goes to the
// cookie source and its CSRF boundary as before.
func ActingSource(cookie UserSource) UserSource { return actingSource{cookie} }

type actingSource struct{ cookie UserSource }

func (a actingSource) User(r *http.Request) (db.User, bool) {
	if user, ok := r.Context().Value(actingKey{}).(db.User); ok {
		return user, true
	}
	return a.cookie.User(r)
}

func (a actingSource) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	if user, ok := r.Context().Value(actingKey{}).(db.User); ok {
		return user, true
	}
	return a.cookie.RequireUser(w, r, signInMessage)
}

// ReadUserSource is what ReadSource hands back: optional auth (User) plus
// mandatory auth (RequireUser) so it can stand in for the cookie service.
type ReadUserSource interface {
	UserSource
}

// ReadSource wraps a cookie source so bearer tokens also authenticate — GET
// only, so a token can never write (ADR-0017).
func (s *Service) ReadSource(cookie ReadUserSource) ReadUserSource {
	return readSource{cookie: cookie, tokens: s}
}

type readSource struct {
	cookie ReadUserSource
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

func (rs readSource) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	// A mutating request goes straight to the cookie source, which is the one
	// CSRF boundary (#678, #2227): `User` resolves a session without checking
	// the Origin — that check lives in `RequireUser` alone — so shortcutting
	// through it here took the boundary off every mutating route of every
	// service built on this source, `DELETE /api/rides/{id}` included. A
	// bearer is GET-only anyway (ADR-0017), so there is nothing to lose.
	if r.Method != http.MethodGet {
		return rs.cookie.RequireUser(w, r, signInMessage)
	}
	if user, ok := rs.User(r); ok {
		return user, true
	}
	// No cookie and no bearer: the cookie source writes the 401-vs-500 refusal.
	return rs.cookie.RequireUser(w, r, signInMessage)
}

type tokenJSON struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
	// Marked for planning (#4207): its MCP coach may save workouts and plan
	// sessions. Absent is read-only.
	Write bool   `json:"write,omitempty"`
	Token string `json:"token,omitempty"` // only ever set at creation
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to manage your tokens.")
	if !ok {
		return
	}
	var req struct {
		Name  string `json:"name"`
		Write bool   `json:"write"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || utf8.RuneCountInString(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A token name has to be 1-60 characters.", "name")
		return
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		httpx.Fail(w, s.log, "token entropy failed", err, "The token could not be created.")
		return
	}
	raw := "wrt_" + hex.EncodeToString(secret)
	hash := sha256.Sum256([]byte(raw))
	// Count and insert in one transaction holding the rider's row (#2258).
	// Listing then inserting is two statements: ten concurrent creates each
	// read nine and each landed, which is the shape #824 closed on the
	// removal side and left open on this one.
	// Null, not false, for a read token: one meaning for every row minted
	// before #4207 and every one after.
	var canWrite *bool
	if req.Write {
		canWrite = &req.Write
	}
	var row db.CreateTokenRow
	err := s.store.WithUserLocked(r.Context(), user.ID, func(q *db.Queries) error {
		n, err := q.CountUserTokens(r.Context(), user.ID)
		if err != nil {
			return err
		}
		if n >= maxTokensPerUser {
			return errTokenCap
		}
		row, err = q.CreateToken(r.Context(), db.CreateTokenParams{
			UserID: user.ID, Name: req.Name, TokenHash: hash[:], CanWrite: canWrite,
		})
		return err
	})
	if errors.Is(err, errTokenCap) {
		// A per-account ceiling is a 429 (errors.md), like the mail budget.
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"Ten tokens is the cap — revoke one you no longer use first.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "token create failed", err, "The token could not be created.")
		return
	}
	s.alarm.TokenMinted(user)
	httpx.WriteJSON(w, http.StatusCreated, tokenJSON{
		ID: store.UUIDString(row.ID), Name: req.Name,
		CreatedAt: row.CreatedAt.Time.Format(time.RFC3339), Write: req.Write,
		Token: raw, // the one and only time it leaves the server
	})
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to manage your tokens.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListUserTokens(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "token list failed", err, "Tokens could not be loaded.")
		return
	}
	out := make([]tokenJSON, 0, len(rows))
	for _, row := range rows {
		entry := tokenJSON{
			ID: store.UUIDString(row.ID), Name: row.Name,
			CreatedAt: row.CreatedAt.Time.Format(time.RFC3339), Write: row.CanWrite,
		}
		if row.LastUsedAt.Valid {
			entry.LastUsedAt = row.LastUsedAt.Time.Format(time.RFC3339)
		}
		out = append(out, entry)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": out})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to manage your tokens.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such token.")
		return
	}
	n, err := s.store.Queries.DeleteToken(r.Context(), db.DeleteTokenParams{ID: id, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "token delete failed", err, "The token could not be revoked.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such token.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Bearer says whether the request carries a personal token, whatever else it
// carries (#1757): the routes that hand out the per-second record — heart
// rate included (ADR-0008) — and the Strava delivery record refuse it.
func Bearer(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ")
}
