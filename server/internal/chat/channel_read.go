package chat

// Reading a text channel: its backlog, and the reader's own read cursor.
// Split from channel_chat.go (#3358).

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (s *Service) handleChannelBacklog(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= protocol.MaxChannelLines {
			limit = n
		}
	}
	rows, err := s.store.Queries.ListChannelChat(r.Context(), db.ListChannelChatParams{
		ChannelID: channel.ID, Limit: int32(limit), //nolint:gosec // bounded to MaxChannelLines above
	})
	if err != nil {
		httpx.Fail(w, s.log, "list channel chat", err, "The chat could not be loaded.", "channel", store.UUIDString(channel.ID))
		return
	}
	reactions, err := s.store.Queries.ListChannelReactions(r.Context(), db.ListChannelReactionsParams{
		ChannelID: channel.ID, Viewer: me.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "list channel reactions", err, "The chat could not be loaded.", "channel", store.UUIDString(channel.ID))
		return
	}
	counts, mine := tally(reactions)
	out := make([]messageJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, messageOf(row, counts, mine))
	}
	// Where the "N new" divider goes; zero when they never read it.
	var readAt int64
	if stamp, err := s.store.Queries.GetChannelReadAt(r.Context(), db.GetChannelReadAtParams{
		ChannelID: channel.ID, UserID: me.ID,
	}); err == nil && stamp.Valid {
		readAt = stamp.Time.UnixMilli()
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.log.Warn("channel read stamp", "err", err, "channel", store.UUIDString(channel.ID))
	}
	body := map[string]any{"messages": out, "readAt": readAt}
	if put := s.channelAnnouncement(r.Context(), channel); put != nil {
		body["announcement"] = put
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

func (s *Service) handleChannelRead(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	upTo, ok := httpx.ReadUpTo(w, r)
	if !ok {
		return
	}
	s.markChannelRead(r.Context(), channel, me, upTo)
	w.WriteHeader(http.StatusNoContent)
}

// markChannelRead moves the rider's cursor to upTo, a line of this channel;
// the zero id means its newest line.
func (s *Service) markChannelRead(ctx context.Context, channel db.Channel, me db.User, upTo pgtype.UUID) {
	if err := s.store.Queries.MarkChannelRead(ctx, db.MarkChannelReadParams{
		ChannelID: channel.ID, UserID: me.ID, UpTo: upTo,
	}); err != nil {
		s.log.Warn("mark channel read failed", "err", err, "channel", store.UUIDString(channel.ID))
		return
	}
	if s.lobby != nil {
		s.lobby.ReadChanged(store.UUIDString(me.ID))
	}
}

// tally folds the reaction rows into emoji → count per line, and which of
// them the viewer pressed.
func tally(rows []db.ListChannelReactionsRow) (map[string]map[string]int, map[string][]string) {
	counts := map[string]map[string]int{}
	mine := map[string][]string{}
	for _, row := range rows {
		id := store.UUIDString(row.MessageID)
		if counts[id] == nil {
			counts[id] = map[string]int{}
		}
		counts[id][row.Emoji] = int(row.Total)
		if row.Mine {
			mine[id] = append(mine[id], row.Emoji)
		}
	}
	return counts, mine
}

// messageOf is one backlog line as the panel draws it.
func messageOf(row db.ListChannelChatRow, counts map[string]map[string]int, mine map[string][]string) messageJSON {
	id := store.UUIDString(row.ID)
	return messageJSON{
		ID: id, From: row.DisplayName, FromID: store.UUIDString(row.UserID),
		Text:      row.Text,
		ImageID:   store.UUIDString(row.ImageID), // "" when the line has none
		At:        row.CreatedAt.Time.UnixMilli(),
		EditedAt:  store.Millis(row.EditedAt),
		ExpiresAt: store.Millis(row.ExpiresAt),
		Reactions: counts[id], Mine: mine[id],
	}
}
