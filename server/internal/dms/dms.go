// Package dms is direct messages under ADR-0012's amendment (#208): they
// exist exactly where friendship exists — the accepted-friendship row is the
// permission, enforced in SQL on every send. Bounded like room chat, no read
// state server-side ("seen" is the reader's own business).
package dms

import (
	"io"
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
	// Four segments, so neither collides with the thread routes above.
	mux.HandleFunc("POST /api/dms/{id}/images", s.handleImageUpload)
	mux.HandleFunc("GET /api/dms/images/{id}", s.handleImage)
}

// maxImageBytes caps one pasted DM image (#285) — the same bar room chat
// holds pasted images to (#279); the client compresses well under it.
const maxImageBytes = 2 << 20

// imageMimes are the only content types stored and served back. Sniffed from
// the bytes, never taken from a header.
func allowedImageMime(mime string) bool {
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return true
	}
	return false
}

// handleImageUpload stores one pasted image for a thread: raw bytes in, blob
// id out, which the sender then puts on a message. The insert carries the
// friendship gate, so a stranger cannot park bytes on someone's row.
func (s *Service) handleImageUpload(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxImageBytes))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "Images are capped at 2 MB.")
		return
	}
	mime := http.DetectContentType(data)
	if !allowedImageMime(mime) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "Only PNG, JPEG, WebP, or GIF images can be sent.")
		return
	}
	id, err := s.store.Queries.SaveDmImage(r.Context(), db.SaveDmImageParams{
		SenderID: me.ID, RecipientID: peer, Mime: mime, Bytes: data,
	})
	if err != nil {
		// Zero rows = the friendship gate refused, same as SendDm.
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only message accepted friends.")
		return
	}
	s.pruneImages(r, me.ID, peer)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": store.UUIDString(id)})
}

// handleImage serves a stored blob to the two people it belongs to. Deliberately
// no friendship re-check: unfriending ends the conversation, it does not black
// out pictures already delivered.
func (s *Service) handleImage(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	img, err := s.store.Queries.GetDmImage(r.Context(), db.GetDmImageParams{
		ImageID: id, ViewerID: me.ID,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	w.Header().Set("Content-Type", img.Mime)
	// Friend-supplied bytes from our own origin: a polyglot that passed the
	// upload sniff must never be re-interpreted as HTML.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = w.Write(img.Bytes)
}

// pruneImages sweeps a pair's orphaned blobs. Called from both writes that can
// grow a thread — a sent message and an upload — so a client that uploads
// without ever sending still triggers the bound.
func (s *Service) pruneImages(r *http.Request, me, peer pgtype.UUID) {
	if err := s.store.Queries.PruneDmImages(r.Context(), db.PruneDmImagesParams{
		Column1: me, Column2: peer,
	}); err != nil {
		s.log.Warn("prune dm images", "err", err)
	}
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
	s.pruneImages(r, me.ID, peer)
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
		// A pasted image's blob id (#285); "" when the message is text only.
		ImageID string `json:"imageId,omitempty"`
		At      int64  `json:"at"`
	}
	out := make([]messageJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, messageJSON{
			ID: store.UUIDString(row.ID), Mine: row.SenderID == me.ID,
			Text: row.Text, ImageID: store.UUIDString(row.ImageID),
			At: row.CreatedAt.Time.UnixMilli(),
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
		// Peer avatar + lifetime XP (#253) for the thread rows.
		PeerAvatarURL    *string `json:"peerAvatarUrl,omitempty"`
		PeerAvatarPreset *string `json:"peerAvatarPreset,omitempty"`
		PeerTotalXp      int64   `json:"peerTotalXp"`
		Text             string  `json:"text"`
		// Whether the latest line was an image, so the list can preview it as
		// something rather than as a blank (#285).
		HasImage bool  `json:"hasImage,omitempty"`
		Mine     bool  `json:"mine"`
		At       int64 `json:"at"`
	}
	out := make([]headJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, headJSON{
			PeerID: store.UUIDString(row.PeerID), PeerName: row.DisplayName,
			PeerAvatarURL: row.AvatarUrl, PeerAvatarPreset: row.AvatarPreset,
			PeerTotalXp: row.TotalXp,
			Text:        row.Text, HasImage: row.ImageID.Valid,
			Mine: row.SenderID == me.ID,
			At:   row.CreatedAt.Time.UnixMilli(),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"conversations": out})
}
