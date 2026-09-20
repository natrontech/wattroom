// The room's announcement (ADR-0057, #2408): one line from a coach that
// outlasts the moment.
//
// There is no composer here and no text in either request. An announcement is
// a chat message a coach MARKED, so what these handlers move is a pointer:
// the sentence was already written, in the box the room already has, and it
// keeps its author, its timestamp and its place in the log.
package rooms

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type announcementJSON struct {
	// The marked message, so a client can find the line it came from.
	MessageID string `json:"messageId"`
	Text      string `json:"text"`
	// The message's author, not whoever marked it: a coach putting somebody
	// else's sentence up is quoting them, and the strip says so.
	From string `json:"from"`
	At   string `json:"at"`
}

func (s *Service) registerAnnouncement(mux *http.ServeMux) {
	mux.HandleFunc("PUT /api/rooms/{slug}/announcement", s.handleSetAnnouncement)
	mux.HandleFunc("DELETE /api/rooms/{slug}/announcement", s.handleClearAnnouncement)
}

// announcementOf is the strip's content for a room, or nil when nothing is
// marked. Absent is the normal state, so a missing row is not a failure.
func (s *Service) announcementOf(r *http.Request, roomID db.Room) *announcementJSON {
	row, err := s.store.Queries.GetRoomAnnouncement(r.Context(), roomID.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		// Never fatal to a room read: the room opens without its notice
		// rather than not at all.
		s.log.Warn("announcement read failed", "err", err, "room", roomID.Slug)
		return nil
	}
	return &announcementJSON{
		MessageID: store.UUIDString(row.ID),
		Text:      row.Text,
		From:      row.FromName,
		At:        row.CreatedAt.Time.Format(time.RFC3339),
	}
}

// handleSetAnnouncement marks a line. PUT, not POST: a room has one
// announcement and marking is writing that one thing, so sending the same
// message id twice leaves the room exactly as it was.
func (s *Service) handleSetAnnouncement(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.RequireModerator(w, r, "Only the room's coach or owner can put up an announcement.")
	if !ok {
		return
	}
	var req struct {
		MessageID string `json:"messageId"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	id, err := store.ParseUUID(req.MessageID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a message id.", "messageId")
		return
	}
	rows, err := s.store.Queries.SetRoomAnnouncement(r.Context(), db.SetRoomAnnouncementParams{
		RoomID: room.ID, MessageID: id,
	})
	if err != nil {
		httpx.Fail(w, s.log, "announcement set failed", err, "The announcement could not be put up.", "room", room.Slug)
		return
	}
	if rows == 0 {
		// The statement refuses a message from another room, so no rows means
		// the line is not this room's — a 404 rather than a 403, for the same
		// reason a foreign pin is: the caller learns nothing about a room
		// they cannot read.
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That message is not in this room.")
		return
	}
	s.log.Info("announcement set", "room", room.Slug, "by", store.UUIDString(user.ID))
	s.changed()
	if put := s.announcementOf(r, room); put != nil {
		httpx.WriteJSON(w, http.StatusOK, put)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleClearAnnouncement(w http.ResponseWriter, r *http.Request) {
	room, _, ok := s.RequireModerator(w, r, "Only the room's coach or owner can take an announcement down.")
	if !ok {
		return
	}
	// Idempotent: taking down a room's announcement when it has none is the
	// state the caller asked for, not a mistake to report.
	if err := s.store.Queries.ClearRoomAnnouncement(r.Context(), room.ID); err != nil {
		httpx.Fail(w, s.log, "announcement clear failed", err, "The announcement could not be taken down.", "room", room.Slug)
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
