// A text channel's chat (ADR-0058, #2435): the backlog, posting, editing,
// deleting, reacting, reading, the images a line may carry and the one
// announcement a channel keeps. HTTP only — there is no socket in a text
// channel — and the fan-out is the lobby ping naming the channel, so a client
// looking at it re-fetches that log and nothing else.
package chat

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Channels is the gate chat stands behind: may this caller enter this text
// channel (channels.mayEnter), and what are they to its crew. Satisfied by
// *channels.Service.
type Channels interface {
	RequireText(w http.ResponseWriter, r *http.Request) (db.Channel, db.User, string, bool)
	RequireCrew(w http.ResponseWriter, r *http.Request) (pgtype.UUID, db.User, string, bool)
}

// Lobby is how everyone else hears (#2435): a ping naming the channel whose
// log changed. Satisfied by the hub. Optional: without it a reader sees new
// lines on their next load.
type Lobby interface {
	ChannelChanged(channelID string)
	ReadChanged(userID string)
}

const noSuchLine = "No such message in this channel."

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

// RegisterChannels mounts a text channel's chat behind gate.
func (s *Service) RegisterChannels(mux *http.ServeMux, gate Channels, lobby Lobby) {
	s.channels, s.lobby = gate, lobby
	mux.HandleFunc("GET /api/channels/{id}/chat", s.handleChannelBacklog)
	mux.HandleFunc("POST /api/channels/{id}/chat", s.handleChannelPost)
	mux.HandleFunc("PATCH /api/channels/{id}/chat/{msg}", s.handleChannelEdit)
	mux.HandleFunc("DELETE /api/channels/{id}/chat/{msg}", s.handleChannelDelete)
	mux.HandleFunc("POST /api/channels/{id}/chat/reactions", s.handleChannelReact)
	mux.HandleFunc("POST /api/channels/{id}/read", s.handleChannelRead)
	mux.HandleFunc("POST /api/channels/{id}/chat/images", s.handleChannelImageUpload)
	mux.HandleFunc("GET /api/channels/{id}/chat/images/{img}", s.handleChannelImage)
	mux.HandleFunc("PUT /api/channels/{id}/announcement", s.handleSetChannelAnnouncement)
	mux.HandleFunc("DELETE /api/channels/{id}/announcement", s.handleClearChannelAnnouncement)
	mux.HandleFunc("GET /api/crews/{id}/announcement", s.handleCrewAnnouncement)
}

// changedIn tells every lobby client which channel moved.
func (s *Service) changedIn(channel db.Channel) {
	if s.lobby != nil {
		s.lobby.ChannelChanged(store.UUIDString(channel.ID))
	}
}

func (s *Service) handleChannelBacklog(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	rows, err := s.store.Queries.ListChannelChat(r.Context(), db.ListChannelChatParams{
		ChannelID: channel.ID, Limit: int32(limit), //nolint:gosec // bounded 1–500 above
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

func (s *Service) handleChannelPost(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok || s.overLine(w, me.ID) {
		return
	}
	var req struct {
		Text    string `json:"text"`
		ImageID string `json:"imageId"`
		// A temporary line's timer in seconds (#2644); absent for one that stays.
		ExpiresIn int `json:"expiresIn"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	text := strings.TrimSpace(req.Text)
	if tooLong(w, text) || httpx.BadTimer(w, req.ExpiresIn) {
		return
	}
	if text == "" && req.ImageID == "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Say something first.", "text")
		return
	}
	var img pgtype.UUID
	if req.ImageID != "" {
		var err error
		if img, err = store.ParseUUID(req.ImageID); err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That image could not be attached.", "imageId")
			return
		}
		// Asked first (#1987): the insert refuses a foreign image the way it
		// refuses a fault, and a stale id deserves an answer the client can act on.
		ours, err := s.store.Queries.ChatImageInChannel(r.Context(), db.ChatImageInChannelParams{ID: img, ChannelID: channel.ID})
		if err != nil {
			httpx.Fail(w, s.log, "chat image lookup", err, "The message could not be sent. Try again.", "channel", store.UUIDString(channel.ID))
			return
		}
		if !ours {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That picture is not in this channel — attach it again.", "imageId")
			return
		}
	}
	at := time.Now().UnixMilli()
	expires := store.ExpiresAt(time.UnixMilli(at), req.ExpiresIn)
	id, err := s.store.Queries.SaveChannelMessage(r.Context(), db.SaveChannelMessageParams{
		ChannelID: channel.ID, UserID: me.ID, Text: text, ImageID: img,
		CreatedAt: pgtype.Timestamptz{Time: time.UnixMilli(at), Valid: true},
		ExpiresAt: expires,
	})
	if err != nil {
		httpx.Fail(w, s.log, "save channel chat", err, "The message could not be sent. Try again.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.pruneChannelSampled(channel.ID)
	// Saying something is reading up to it.
	s.markChannelRead(r.Context(), channel, me, id)
	s.changedIn(channel)
	httpx.WriteJSON(w, http.StatusOK, protocol.ChatLine{
		ID: store.UUIDString(id), From: me.DisplayName, FromID: store.UUIDString(me.ID),
		Text: text, ImageID: req.ImageID, At: at, ExpiresAt: store.Millis(expires),
	})
}

// pruneChannelSampled bounds a channel: 500 lines, and the images nothing
// points at, one write in sixteen and off the request — every save used to
// pay a delete-with-subquery that stalled the sender (audit #219). The prune
// outlives the request on purpose, bounded by its own timeout.
func (s *Service) pruneChannelSampled(channelID pgtype.UUID) {
	if time.Now().UnixNano()%16 != 0 {
		return
	}
	safego.Go(s.log, "channel chat prune", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.store.Queries.PruneChannelChat(ctx, channelID); err != nil {
			s.log.Warn("prune channel chat", "err", err, "channel", store.UUIDString(channelID))
		}
		if err := s.store.Queries.PruneChannelImages(ctx, channelID); err != nil {
			s.log.Warn("prune channel images", "err", err, "channel", store.UUIDString(channelID))
		}
	})
}

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
	s.changedIn(channel)
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
	s.changedIn(channel)
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
		count, err = s.store.Queries.CountChatReaction(r.Context(), db.CountChatReactionParams{MessageID: mid, Emoji: req.Emoji})
	}
	if err != nil {
		httpx.Fail(w, s.log, "channel reaction", err, "The reaction did not land. Try again.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.changedIn(channel)
	httpx.WriteJSON(w, http.StatusOK, protocol.ChatReactionCount{
		MessageID: req.MessageID, Emoji: req.Emoji, Count: int(count),
		By: store.UUIDString(me.ID), Added: added > 0,
	})
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

func (s *Service) handleChannelImageUpload(w http.ResponseWriter, r *http.Request) {
	channel, me, _, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	if !s.uploads.Spend(me.ID) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of pictures in one hour — a moment, then attach it again.")
		return
	}
	data, mime, ok := httpx.ReadImageUpload(w, r)
	if !ok {
		return
	}
	id, err := s.store.Queries.SaveChannelImage(r.Context(), db.SaveChannelImageParams{
		ChannelID: channel.ID, UserID: me.ID, Mime: mime, Bytes: data,
	})
	if err != nil {
		httpx.Fail(w, s.log, "save channel image", err, "The image could not be saved.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.pruneChannelSampled(channel.ID)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": store.UUIDString(id)})
}

func (s *Service) handleChannelImage(w http.ResponseWriter, r *http.Request) {
	channel, _, _, ok := s.channels.RequireText(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("img"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	img, err := s.store.Queries.GetChannelImage(r.Context(), db.GetChannelImageParams{ID: id, ChannelID: channel.ID})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	httpx.ServeImmutableImage(w, img.Mime, img.Bytes)
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
	s.changedIn(channel)
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
	s.changedIn(channel)
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
