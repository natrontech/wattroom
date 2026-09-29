package chat

// A text channel's announcement, and the crew's view of all of them. Split
// from channel_chat.go (#3358).

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Announcement is a text channel's marked line (ADR-0057 as amended by
// ADR-0058) as the channel's strip and the crew's Board draw it.
type Announcement struct {
	MessageID string `json:"messageId"`
	Text      string `json:"text"`
	// The message's author, not whoever marked it — by name, and by id for
	// the status beside it (ADR-0060).
	From   string `json:"from"`
	FromID string `json:"fromId"`
	At     string `json:"at"`
	// Set on the crew Board's read, which leads with the newest across the
	// crew's text channels and has to say which one it is from.
	ChannelID   string `json:"channelId,omitempty"`
	ChannelName string `json:"channelName,omitempty"`
}

// channelAnnouncement is the channel's marked line, or nil when none is up.
func (s *Service) channelAnnouncement(ctx context.Context, channel db.Channel) *Announcement {
	row, err := s.store.Queries.GetChannelAnnouncement(ctx, channel.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		s.log.Warn("channel announcement read failed", "err", err, "channel", store.UUIDString(channel.ID))
		return nil
	}
	return &Announcement{
		MessageID: store.UUIDString(row.ID), Text: row.Text, From: row.FromName, FromID: store.UUIDString(row.FromID),
		At: row.CreatedAt.Time.Format(time.RFC3339),
	}
}

// handleSetChannelAnnouncement marks a line (ADR-0057 as amended by
// ADR-0058): the crew's owner and admins, because an announcement speaks for
// the crew. PUT — marking the same line twice leaves the channel as it was.
func (s *Service) handleSetChannelAnnouncement(w http.ResponseWriter, r *http.Request) {
	channel, me, role, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	if !channels.Administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner or an admin can put up an announcement.")
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
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a message id.", "messageId")
		return
	}
	rows, err := s.store.Queries.SetChannelAnnouncement(r.Context(), db.SetChannelAnnouncementParams{
		ChannelID: channel.ID, MessageID: id,
	})
	if err != nil {
		httpx.Fail(w, s.log, "channel announcement set failed", err, "The announcement could not be put up.", "channel", store.UUIDString(channel.ID))
		return
	}
	if rows == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That message is not in this channel.")
		return
	}
	s.log.Info("announcement set", "channel", store.UUIDString(channel.ID), "by", store.UUIDString(me.ID))
	s.changedIn(r.Context(), channel)
	if put := s.channelAnnouncement(r.Context(), channel); put != nil {
		httpx.WriteJSON(w, http.StatusOK, put)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleClearChannelAnnouncement is idempotent: taking down none is the state
// the caller asked for.
func (s *Service) handleClearChannelAnnouncement(w http.ResponseWriter, r *http.Request) {
	channel, _, role, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	if !channels.Administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner or an admin can take an announcement down.")
		return
	}
	if err := s.store.Queries.ClearChannelAnnouncement(r.Context(), channel.ID); err != nil {
		httpx.Fail(w, s.log, "channel announcement clear failed", err, "The announcement could not be taken down.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.changedIn(r.Context(), channel)
	w.WriteHeader(http.StatusNoContent)
}

// handleCrewAnnouncement is what the crew's Board leads with (ADR-0058): the
// newest announcement across the crew's text channels the caller may enter.
// 204 when none is up — the Board's normal state.
func (s *Service) handleCrewAnnouncement(w http.ResponseWriter, r *http.Request) {
	crew, me, role, ok := s.channels.RequireCrew(w, r)
	if !ok {
		return
	}
	row, err := s.store.Queries.NewestCrewAnnouncement(r.Context(), db.NewestCrewAnnouncementParams{
		CrewID: crew, Viewer: me.ID, Admin: channels.Administers(role),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "crew announcement read failed", err, "The announcement could not be loaded.", "crew", store.UUIDString(crew))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, Announcement{
		MessageID: store.UUIDString(row.ID), Text: row.Text, From: row.FromName, FromID: store.UUIDString(row.FromID),
		At:        row.CreatedAt.Time.Format(time.RFC3339),
		ChannelID: store.UUIDString(row.ChannelID), ChannelName: row.ChannelName,
	})
}
