// Package status is a rider's own line (ADR-0060, #2694): an emoji and a few
// words the rider sets and clears, shown wherever their name is shown. The
// surfaces carry it beside the name through Of; this package owns writing it
// and the one read a status adds — a worn crew emoji's picture, served
// outside its crew while somebody wears it.
package status

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Users is the signed-in gate. Satisfied by *auth.Service.
type Users interface {
	RequireUser(w http.ResponseWriter, r *http.Request, message string) (db.User, bool)
}

// Lobby is how everybody else's screens hear a status changed: the lobby's
// re-fetch ping, the one a friend coming online sends. Satisfied by the hub.
type Lobby interface {
	PresenceChanged()
}

type Service struct {
	store *store.Store
	users Users
	lobby Lobby
	log   *slog.Logger
	now   func() time.Time
}

func New(st *store.Store, users Users, lobby Lobby, log *slog.Logger) *Service {
	return &Service{store: st, users: users, lobby: lobby, log: log, now: time.Now}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("PUT /api/me/status", s.handleSet)
	mux.HandleFunc("DELETE /api/me/status", s.handleClear)
	mux.HandleFunc("GET /api/emoji/{id}", s.handleImage)
}

// Of is a rider's status columns as the wire carries them: nil for none, and
// nil once it has cleared — nothing sweeps the columns, so every read asks.
func Of(emoji *string, emojiID pgtype.UUID, text *string, expiresAt pgtype.Timestamptz, now time.Time) *protocol.StatusLine {
	if emoji == nil && text == nil {
		return nil
	}
	if expiresAt.Valid && !expiresAt.Time.After(now) {
		return nil
	}
	out := &protocol.StatusLine{}
	if emoji != nil {
		out.Emoji = *emoji
	}
	if text != nil {
		out.Text = *text
	}
	if emojiID.Valid {
		out.EmojiID = store.UUIDString(emojiID)
	}
	if expiresAt.Valid {
		out.ExpiresAt = expiresAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// OfUser is Of for a whole users row.
func OfUser(u db.User, now time.Time) *protocol.StatusLine {
	return Of(u.StatusEmoji, u.StatusEmojiID, u.StatusText, u.StatusExpiresAt, now)
}

type setRequest struct {
	// A Unicode emoji. Ignored when EmojiID names a crew emoji, whose
	// `:name:` the server reads from the row rather than believing.
	Emoji   string `json:"emoji"`
	EmojiID string `json:"emojiId"`
	Text    string `json:"text"`
	// RFC 3339, from the client: only it knows when the rider's "today"
	// ends. Empty is "don't clear".
	ExpiresAt string `json:"expiresAt"`
}

func (s *Service) handleSet(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Sign in to set a status.")
	if !ok {
		return
	}
	var req setRequest
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That status could not be read.")
		return
	}
	text := strings.TrimSpace(req.Text)
	if utf8.RuneCountInString(text) > protocol.MaxStatusChars {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			fmt.Sprintf("A status is at most %d characters.", protocol.MaxStatusChars), "text")
		return
	}
	if strings.ContainsFunc(text, unicode.IsControl) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A status is one line — take out the line breaks.", "text")
		return
	}

	params := db.SetUserStatusParams{ID: me.ID}
	if text != "" {
		params.Text = &text
	}
	switch {
	case req.EmojiID != "":
		id, err := store.ParseUUID(req.EmojiID)
		if err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", notYourEmoji, "emoji")
			return
		}
		name, err := s.store.Queries.WearableCrewEmoji(r.Context(), db.WearableCrewEmojiParams{ID: id, UserID: me.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", notYourEmoji, "emoji")
			return
		}
		if err != nil {
			httpx.Fail(w, s.log, "status emoji lookup failed", err, "The status could not be saved. Try again.")
			return
		}
		key := ":" + name + ":"
		params.Emoji, params.EmojiID = &key, id
	case req.Emoji != "":
		if !protocol.IsEmoji(req.Emoji) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A status takes one emoji.", "emoji")
			return
		}
		params.Emoji = &req.Emoji
	}
	if params.Emoji == nil && params.Text == nil {
		// Setting neither is clearing it (docs/SPEC.md), not an error.
		s.clear(w, r, me.ID)
		return
	}
	if req.ExpiresAt != "" {
		at, err := time.Parse(time.RFC3339, req.ExpiresAt)
		if err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"That clearing time could not be read.", "expiresAt")
			return
		}
		if !at.After(s.now()) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"That time has already passed — pick a later one, or don't clear it.", "expiresAt")
			return
		}
		params.ExpiresAt = pgtype.Timestamptz{Time: at, Valid: true}
	}

	if err := s.store.Queries.SetUserStatus(r.Context(), params); err != nil {
		httpx.Fail(w, s.log, "status set failed", err, "The status could not be saved. Try again.")
		return
	}
	s.lobby.PresenceChanged()
	httpx.WriteJSON(w, http.StatusOK,
		Of(params.Emoji, params.EmojiID, params.Text, params.ExpiresAt, s.now()))
}

const notYourEmoji = "That emoji is not in any of your crews."

func (s *Service) handleClear(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Sign in to clear your status.")
	if !ok {
		return
	}
	s.clear(w, r, me.ID)
}

func (s *Service) clear(w http.ResponseWriter, r *http.Request, me pgtype.UUID) {
	if err := s.store.Queries.ClearUserStatus(r.Context(), me); err != nil {
		httpx.Fail(w, s.log, "status clear failed", err, "The status could not be cleared. Try again.")
		return
	}
	s.lobby.PresenceChanged()
	w.WriteHeader(http.StatusNoContent)
}

// handleImage serves a crew emoji somebody wears (ADR-0060) to anyone signed
// in. Its crew's own members read it through the crew's gate as before; this
// is the door for everybody else, and it closes when the last status wearing
// it clears. The id is the emoji's, never reused, so the browser keeps it.
func (s *Service) handleImage(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Not signed in."); !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Nobody wears that emoji.")
		return
	}
	img, err := s.store.Queries.WornCrewEmojiImage(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Nobody wears that emoji.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "status emoji image failed", err, "The emoji could not be loaded.")
		return
	}
	httpx.ServeImmutableImage(w, img.Mime, img.Bytes)
}
