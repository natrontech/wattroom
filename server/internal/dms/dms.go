// Package dms is direct messages under ADR-0012's amendment (#208): they
// exist exactly where friendship exists — the accepted-friendship row is the
// permission, enforced in SQL on every send. Bounded like room chat, no read
// state server-side ("seen" is the reader's own business).
package dms

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource resolves the signed-in user — same shape rooms consumes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
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
	mux.HandleFunc("GET /api/dms", s.handleHeads)
	mux.HandleFunc("GET /api/dms/{id}", s.handleThread)
	mux.HandleFunc("POST /api/dms/{id}", s.handleSend)
}

func (s *Service) peer(w http.ResponseWriter, r *http.Request) (db.User, pgtype.UUID, bool) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.User{}, pgtype.UUID{}, false
	}
	peer, err := store.ParseUUID(r.PathValue("id"))
	if err != nil || peer == me.ID {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not someone you can message.")
		return db.User{}, pgtype.UUID{}, false
	}
	return me, peer, true
}

func (s *Service) handleSend(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" || utf8.RuneCountInString(text) > 500 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "A message is 1–500 characters.", "text")
		return
	}
	sent, err := s.store.Queries.SendDm(r.Context(), db.SendDmParams{
		SenderID: me.ID, RecipientID: peer, Text: text,
	})
	if err != nil {
		// Zero rows back = the friendship gate refused (pgx.ErrNoRows) — the
		// one way a valid request lands here.
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only message accepted friends.")
		return
	}
	if err := s.store.Queries.PruneDms(r.Context(), db.PruneDmsParams{
		Column1: me.ID, Column2: peer,
	}); err != nil {
		s.log.Warn("prune dms", "err", err)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id": store.UUIDString(sent.ID), "at": sent.CreatedAt.Time.UnixMilli(),
	})
}

func (s *Service) handleThread(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	after := time.Unix(0, 0)
	if raw := r.URL.Query().Get("after"); raw != "" {
		if ms, err := strconv.ParseInt(raw, 10, 64); err == nil {
			after = time.UnixMilli(ms)
		}
	}
	rows, err := s.store.Queries.ListDms(r.Context(), db.ListDmsParams{
		Column1: me.ID, Column2: peer,
		CreatedAt: pgtype.Timestamptz{Time: after, Valid: true},
	})
	if err != nil {
		s.log.Error("list dms", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Messages could not be loaded.")
		return
	}
	type messageJSON struct {
		ID   string `json:"id"`
		Mine bool   `json:"mine"`
		Text string `json:"text"`
		At   int64  `json:"at"`
	}
	out := make([]messageJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, messageJSON{
			ID: store.UUIDString(row.ID), Mine: row.SenderID == me.ID,
			Text: row.Text, At: row.CreatedAt.Time.UnixMilli(),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (s *Service) handleHeads(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListDmHeads(r.Context(), me.ID)
	if err != nil {
		s.log.Error("list dm heads", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Messages could not be loaded.")
		return
	}
	type headJSON struct {
		PeerID   string `json:"peerId"`
		PeerName string `json:"peerName"`
		Text     string `json:"text"`
		Mine     bool   `json:"mine"`
		At       int64  `json:"at"`
	}
	out := make([]headJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, headJSON{
			PeerID: store.UUIDString(row.PeerID), PeerName: row.DisplayName,
			Text: row.Text, Mine: row.SenderID == me.ID,
			At: row.CreatedAt.Time.UnixMilli(),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"conversations": out})
}
