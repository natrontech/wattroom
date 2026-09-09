// Package dms is direct messages under ADR-0012's amendment (#208): they
// exist exactly where friendship exists — the accepted-friendship row is the
// permission, enforced in SQL on every send. Bounded like room chat, no read
// state server-side ("seen" is the reader's own business).
package dms

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
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
	mux.HandleFunc("POST /api/dms/{id}/reactions", s.handleReact)
	mux.HandleFunc("PATCH /api/dms/{id}/messages/{messageId}", s.handleEdit)
	// Four segments, so neither collides with the thread routes above.
	mux.HandleFunc("POST /api/dms/{id}/images", s.handleImageUpload)
	mux.HandleFunc("GET /api/dms/images/{id}", s.handleImage)
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
		Text    string `json:"text"`
		ImageID string `json:"imageId"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	text := strings.TrimSpace(req.Text)
	if utf8.RuneCountInString(text) > 500 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "A message is 1–500 characters.", "text")
		return
	}
	// An image is a message body of its own (#285), so text is only required
	// when there is nothing else to send.
	image, imageErr := store.ParseUUID(req.ImageID)
	if req.ImageID != "" && imageErr != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That image could not be attached.", "imageId")
		return
	}
	if text == "" && req.ImageID == "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "A message is 1–500 characters.", "text")
		return
	}
	sent, err := s.store.Queries.SendDm(r.Context(), db.SendDmParams{
		SenderID: me.ID, RecipientID: peer, Text: text, ImageID: image,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Zero rows back = the friendship gate refused — the one way a valid
		// request lands here.
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only message accepted friends.")
		return
	}
	if err != nil {
		// Not "not friends": the database did not answer (audit 2026-09-09).
		s.log.Error("dm send failed", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The message could not be sent. Try again.")
		return
	}
	if err := s.store.Queries.PruneDms(r.Context(), db.PruneDmsParams{
		Column1: me.ID, Column2: peer,
	}); err != nil {
		s.log.Warn("prune dms", "err", err)
	}
	s.pruneImages(r, me.ID, peer)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id": store.UUIDString(sent.ID), "at": sent.CreatedAt.Time.UnixMilli(),
	})
}

// handleEdit rewrites a message the caller sent (#865) — the DM twin of
// chat's handleEdit, with the same two rules: sender only, text only. Like a
// reaction here, there is no live wire to announce it on; the peer picks the
// new text up on their next poll.
func (s *Service) handleEdit(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	mid, err := store.ParseUUID(r.PathValue("messageId"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this conversation.")
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
	if utf8.RuneCountInString(text) > 500 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "A message is 1–500 characters.", "text")
		return
	}
	msg, err := s.store.Queries.GetDmMessage(r.Context(), db.GetDmMessageParams{
		ID: mid, Column2: me.ID, Column3: peer,
	})
	if err != nil {
		// Pair-scoped read: not this conversation's message, or none at all.
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this conversation.")
		return
	}
	if msg.SenderID != me.ID {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only edit your own messages.")
		return
	}
	// An image is a message body of its own (#285), so the words may go —
	// but a text-only line cannot be edited down to nothing.
	if text == "" && !msg.ImageID.Valid {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "A message is 1–500 characters.", "text")
		return
	}
	edited, err := s.store.Queries.EditDmMessage(r.Context(), db.EditDmMessageParams{
		ID: mid, SenderID: me.ID, Column3: peer, Text: text,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this conversation.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, protocol.ChatEdit{
		MessageID: store.UUIDString(mid), Text: text, EditedAt: store.Millis(edited),
	})
}

// handleReact toggles the caller's reaction on a message in this thread
// (#777, follow-up from #672) — the DM twin of chat's handleReact. Unlike a
// room, a DM has no live tick to ride: the change is only ever picked up by
// the peer's next poll (thread.svelte.ts refreshes reactions every load).
func (s *Service) handleReact(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	var req struct {
		MessageID string `json:"messageId"`
		Emoji     string `json:"emoji"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if !protocol.IsIconOrEmoji(req.Emoji) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a reaction this thread speaks.", "emoji")
		return
	}
	mid, err := store.ParseUUID(req.MessageID)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this conversation.")
		return
	}
	added, err := s.store.Queries.AddDmReaction(r.Context(), db.AddDmReactionParams{
		MessageID: mid, UserID: me.ID, Emoji: req.Emoji, Column4: me.ID, Column5: peer,
	})
	if err != nil {
		s.log.Warn("add dm reaction", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The reaction could not be saved.")
		return
	}
	isAdd := added > 0
	if !isAdd {
		removed, err := s.store.Queries.RemoveDmReaction(r.Context(), db.RemoveDmReactionParams{
			MessageID: mid, UserID: me.ID, Emoji: req.Emoji, Column4: me.ID, Column5: peer,
		})
		if err != nil {
			s.log.Warn("remove dm reaction", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The reaction could not be saved.")
			return
		}
		if removed == 0 {
			// Neither added nor removed: the message is not in this pair's
			// thread — same 404 the insert's own scoping would produce.
			httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this conversation.")
			return
		}
	}
	count, err := s.store.Queries.CountDmReaction(r.Context(), db.CountDmReactionParams{
		MessageID: mid, Emoji: req.Emoji,
	})
	if err != nil {
		s.log.Error("count dm reaction", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The reaction could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, protocol.ChatReactionCount{
		MessageID: req.MessageID, Emoji: req.Emoji, Count: int(count),
		By: store.UUIDString(me.ID), Added: isAdd,
	})
}
