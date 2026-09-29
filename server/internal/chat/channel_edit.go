package chat

// Changing a line already in a text channel: its author's edit and delete,
// and anyone's reaction. Split from channel_chat.go (#3358).

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleChannelEdit: the author rewrites their own words (#865), text only.
func (s *Service) handleChannelEdit(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok || s.overLine(w, me.ID) {
		return
	}
	id, err := store.ParseUUID(r.PathValue("msg"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchLine)
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
	if tooLong(w, text) {
		return
	}
	msg, ok := s.channelLine(w, r, channel, id, "edited")
	if !ok {
		return
	}
	if msg.UserID != me.ID {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only edit your own messages.")
		return
	}
	if text == "" && !msg.ImageID.Valid {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"An edited message still has to say something.", "text")
		return
	}
	edited, err := s.store.Queries.EditChannelMessage(r.Context(), db.EditChannelMessageParams{
		ID: id, ChannelID: channel.ID, Text: text, UserID: me.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchLine)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "edit channel message", err, "The message could not be edited. Try again.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.changedIn(r.Context(), channel)
	httpx.WriteJSON(w, http.StatusOK, protocol.ChatEdit{
		MessageID: store.UUIDString(id), Text: text, EditedAt: store.Millis(edited),
	})
}

// handleChannelDelete: the author always may (#2417); so may the crew's owner
// and admins, who keep its channels (ADR-0058) — a ban severs a griefer and
// their words would otherwise stay up.
func (s *Service) handleChannelDelete(w http.ResponseWriter, r *http.Request) {
	channel, me, role, ok := s.channels.RequireText(w, r)
	if !ok || s.overLine(w, me.ID) {
		return
	}
	id, err := store.ParseUUID(r.PathValue("msg"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchLine)
		return
	}
	msg, ok := s.channelLine(w, r, channel, id, "deleted")
	if !ok {
		return
	}
	if msg.UserID != me.ID && !channels.Administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only delete your own messages.")
		return
	}
	rows, err := s.store.Queries.DeleteChannelMessage(r.Context(), db.DeleteChannelMessageParams{ID: id, ChannelID: channel.ID})
	if err != nil {
		httpx.Fail(w, s.log, "delete channel message", err, "The message could not be deleted. Try again.", "channel", store.UUIDString(channel.ID))
		return
	}
	if rows == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchLine)
		return
	}
	// A fact, never the words.
	if msg.UserID != me.ID {
		s.log.Info("chat line deleted by a crew admin",
			"channel", store.UUIDString(channel.ID), "by", store.UUIDString(me.ID), "author", store.UUIDString(msg.UserID))
	}
	s.changedIn(r.Context(), channel)
	w.WriteHeader(http.StatusNoContent)
}

// channelLine reads a line for an edit or a delete, telling "no such line"
// (404) from a fault (500) so the handler can then tell "not yours" (403).
func (s *Service) channelLine(w http.ResponseWriter, r *http.Request, channel db.Channel, id pgtype.UUID, verb string) (db.GetChannelMessageRow, bool) {
	msg, err := s.store.Queries.GetChannelMessage(r.Context(), db.GetChannelMessageParams{ID: id, ChannelID: channel.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchLine)
		return msg, false
	}
	if err != nil {
		httpx.Fail(w, s.log, "get channel message", err, "The message could not be "+verb+". Try again.", "channel", store.UUIDString(channel.ID))
		return msg, false
	}
	return msg, true
}

// handleChannelReact toggles the caller's reaction: add if absent, remove if
// present, and answer the new total.
func (s *Service) handleChannelReact(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok || s.overLine(w, me.ID) {
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
	if !protocol.IsReaction(req.Emoji) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a reaction this crew speaks.", "emoji")
		return
	}
	mid, err := store.ParseUUID(req.MessageID)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchLine)
		return
	}
	added, err := s.store.Queries.AddChannelReaction(r.Context(), db.AddChannelReactionParams{
		MessageID: mid, UserID: me.ID, Emoji: req.Emoji, ChannelID: channel.ID,
	})
	if err == nil && added == 0 {
		var removed int64
		removed, err = s.store.Queries.RemoveChannelReaction(r.Context(), db.RemoveChannelReactionParams{
			MessageID: mid, UserID: me.ID, Emoji: req.Emoji, ChannelID: channel.ID,
		})
		if err == nil && removed == 0 {
			// Neither added nor removed: the line is not in this channel.
			httpx.WriteError(w, http.StatusNotFound, "not_found", noSuchLine)
			return
		}
	}
	var count int64
	if err == nil {
		count, err = s.store.Queries.CountChatReaction(r.Context(), db.CountChatReactionParams{MessageID: mid, Emoji: req.Emoji, Viewer: me.ID})
	}
	if err != nil {
		httpx.Fail(w, s.log, "channel reaction", err, "The reaction did not land. Try again.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.changedIn(r.Context(), channel)
	httpx.WriteJSON(w, http.StatusOK, protocol.ChatReactionCount{
		MessageID: req.MessageID, Emoji: req.Emoji, Count: int(count),
		By: store.UUIDString(me.ID), Added: added > 0,
	})
}
