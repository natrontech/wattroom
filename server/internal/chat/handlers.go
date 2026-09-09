// The HTTP side of a room's chat: the backlog, posting, editing, reacting
// and reading from outside the room, and the images a line may carry.
// The hub-facing API (SaveChat, ToggleReaction) stays in chat.go.
package chat

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// member gates a chat endpoint: signed in, room exists, requester belongs and
// is not banned — chat never leaves the room (ADR-0010), and neither do its
// images.
func (s *Service) member(w http.ResponseWriter, r *http.Request) (db.Room, db.User, bool) {
	return s.members.RequireMember(w, r, "Chat is for the room's members.")
}

// handleImageUpload stores one pasted image: raw bytes in, blob id out. The
// sender then puts that id on a chat line; never-sent uploads are swept by
// PruneChatImages. ponytail: no per-user rate limit — members only, and the
// sampled sweep below bounds a flood at roughly one grace window of orphans
// (~15 min of uploads) rather than forever; add a limiter if that shows up.
func (s *Service) handleImageUpload(w http.ResponseWriter, r *http.Request) {
	room, me, ok := s.member(w, r)
	if !ok {
		return
	}
	data, mime, ok := httpx.ReadImageUpload(w, r)
	if !ok {
		return
	}
	id, err := s.store.Queries.SaveChatImage(r.Context(), db.SaveChatImageParams{
		RoomID: room.ID, UserID: me.ID, Mime: mime, Bytes: data,
	})
	if err != nil {
		httpx.Fail(w, s.log, "save chat image", err, "The image could not be saved.", "room", room.Slug)
		return
	}
	// Uploads sweep too: a member who uploads but never sends would otherwise
	// never trigger the bound, since only chat lines used to run it.
	s.pruneSampled(room.ID, room.Slug)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": store.UUIDString(id)})
}

// handleImage serves a stored blob to the room's members. A blob never
// changes under its id — cache privately, forever.
func (s *Service) handleImage(w http.ResponseWriter, r *http.Request) {
	room, _, ok := s.member(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	img, err := s.store.Queries.GetChatImage(r.Context(), db.GetChatImageParams{ID: id, RoomID: room.ID})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	httpx.ServeImmutableImage(w, img.Mime, img.Bytes)
}

// handleBacklog is the join-time load: the newest lines, oldest first,
// members only.
func (s *Service) handleBacklog(w http.ResponseWriter, r *http.Request) {
	room, me, ok := s.member(w, r)
	if !ok {
		return
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	rows, err := s.store.Queries.ListRoomChat(r.Context(), db.ListRoomChatParams{
		RoomID: room.ID, Limit: int32(limit), //nolint:gosec // bounded 1–500 above
	})
	if err != nil {
		httpx.Fail(w, s.log, "list chat", err, "The chat could not be loaded.", "room", room.Slug)
		return
	}
	reactions, err := s.store.Queries.ListChatReactions(r.Context(), db.ListChatReactionsParams{
		RoomID: room.ID, UserID: me.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "list reactions", err, "The chat could not be loaded.", "room", room.Slug)
		return
	}
	counts := map[string]map[string]int{}
	mine := map[string][]string{}
	for _, row := range reactions {
		id := store.UUIDString(row.MessageID)
		if counts[id] == nil {
			counts[id] = map[string]int{}
		}
		counts[id][row.Emoji] = int(row.Total)
		if row.Mine {
			mine[id] = append(mine[id], row.Emoji)
		}
	}
	out := make([]messageJSON, 0, len(rows))
	for _, row := range rows {
		id := store.UUIDString(row.ID)
		out = append(out, messageJSON{
			ID: id, From: row.DisplayName, FromID: store.UUIDString(row.UserID),
			Text:      row.Text,
			ImageID:   store.UUIDString(row.ImageID), // "" when the line has none
			At:        row.CreatedAt.Time.UnixMilli(),
			EditedAt:  store.Millis(row.EditedAt),
			Reactions: counts[id], Mine: mine[id],
		})
	}
	// When the viewer last opened this room (#468): read from outside, the
	// client draws its "N new" divider above the first line past it. Zero
	// when they never have — everything in the log is new to them then.
	var readAt int64
	if stamp, err := s.store.Queries.GetRoomReadAt(r.Context(), db.GetRoomReadAtParams{
		RoomID: room.ID, UserID: me.ID,
	}); err == nil && stamp.Valid {
		readAt = stamp.Time.UnixMilli()
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.log.Warn("room read stamp", "err", err, "room", room.Slug)
	}
	// The room's durable session cards (ADR-0034), on the same response as
	// the messages they interleave with. A recap that cannot be read is not
	// worth failing a conversation over: the timeline renders without it.
	recaps := []protocol.SessionRecap{}
	if s.recaps != nil {
		// Bounded like the messages above and by the same argument — the
		// backlog is what one scrollback can hold, not the whole history.
		if rows, err := s.recaps.List(r.Context(), room.ID, 50); err == nil {
			recaps = rows
		} else {
			s.log.Warn("list recaps", "err", err, "room", room.Slug)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"messages": out, "readAt": readAt, "recaps": recaps,
	})
}

// handlePost is a chat line from OUTSIDE the room (#468): a member who is
// not connected — reading the thread from /messages — says something, and
// the riders who are in the room see it on their next tick. Validated like
// the socket path, persisted through the same keeper; the difference is
// that the save is synchronous here, so the line reaches the room with its
// id already on it and reactions work at once.
func (s *Service) handlePost(w http.ResponseWriter, r *http.Request) {
	room, me, ok := s.member(w, r)
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
	if utf8.RuneCountInString(text) > maxChatRunes {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That message is too long — 500 characters is the cap.", "text")
		return
	}
	if req.ImageID != "" {
		if _, err := store.ParseUUID(req.ImageID); err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That image could not be attached.", "imageId")
			return
		}
	}
	if text == "" && req.ImageID == "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Say something first.", "text")
		return
	}
	id, saved := s.SaveChat(r.Context(), room.Slug, store.UUIDString(me.ID), text, req.ImageID)
	if !saved {
		// SaveChat refuses an image from another room the same way it
		// refuses a database fault; the only one of those a valid request
		// can cause is the image.
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The message could not be sent. Try again.")
		return
	}
	line := protocol.ChatLine{
		ID: id, From: me.DisplayName, FromID: store.UUIDString(me.ID),
		Text: text, ImageID: req.ImageID, At: time.Now().UnixMilli(),
	}
	if s.live != nil {
		s.live.PostChat(room.Slug, line)
	}
	// Saying something is reading up to it.
	s.markRead(r.Context(), room, me)
	httpx.WriteJSON(w, http.StatusOK, line)
}

// handleEdit rewrites a line its author already sent (#865). Sender only —
// editing someone else's words is a moderator power this deliberately is
// not — and only the text: an attached image stays where it is, so clearing
// the words of an image line leaves the picture rather than emptying it.
//
// HTTP for both halves of the room: a member reading from /messages and a
// rider standing in the lounge call the same endpoint, and the hub carries
// the new text to whoever is connected. Unlike a reaction there is no socket
// path, because an edit is a once-in-a-while repair, not a mid-ride input.
func (s *Service) handleEdit(w http.ResponseWriter, r *http.Request) {
	room, me, ok := s.member(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this room.")
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
	if utf8.RuneCountInString(text) > maxChatRunes {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That message is too long — 500 characters is the cap.", "text")
		return
	}
	msg, err := s.store.Queries.GetChatMessage(r.Context(), db.GetChatMessageParams{ID: id, RoomID: room.ID})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "get chat message", err, "The message could not be edited. Try again.", "room", room.Slug)
			return
		}
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this room.")
		return
	}
	if msg.UserID != me.ID {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only edit your own messages.")
		return
	}
	// A line with a picture may lose its words; one without would become
	// nothing at all, and deleting is a different button than editing.
	if text == "" && !msg.ImageID.Valid {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"An edited message still has to say something.", "text")
		return
	}
	edited, err := s.store.Queries.EditChatMessage(r.Context(), db.EditChatMessageParams{
		ID: id, RoomID: room.ID, Text: text, UserID: me.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Pruned, or moved out from under the read above — either way it
			// is no longer a line in this room.
			httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this room.")
			return
		}
		httpx.Fail(w, s.log, "edit chat message", err, "The message could not be edited. Try again.", "room", room.Slug)
		return
	}
	change := protocol.ChatEdit{
		MessageID: store.UUIDString(id), Text: text, EditedAt: store.Millis(edited),
	}
	if s.live != nil {
		s.live.PostChatEdit(room.Slug, change)
	}
	httpx.WriteJSON(w, http.StatusOK, change)
}

// handleReact toggles the caller's reaction over HTTP (#468) — the socket's
// ChatReact for a member reading from outside. The changed total reaches
// the room the same way a socket toggle does.
func (s *Service) handleReact(w http.ResponseWriter, r *http.Request) {
	room, me, ok := s.member(w, r)
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
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a reaction this room speaks.", "emoji")
		return
	}
	count, added, ok := s.ToggleReaction(r.Context(), room.Slug, req.MessageID, store.UUIDString(me.ID), req.Emoji)
	if !ok {
		// The insert and the delete both scope by room: a message that is
		// not in this room's log does not exist here.
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such message in this room.")
		return
	}
	change := protocol.ChatReactionCount{
		MessageID: req.MessageID, Emoji: req.Emoji, Count: count,
		By: store.UUIDString(me.ID), Added: added,
	}
	if s.live != nil {
		s.live.PostReaction(room.Slug, change)
	}
	httpx.WriteJSON(w, http.StatusOK, change)
}

// handleRead stamps the room read (#468) — the same stamp opening the room
// sets, for a member who read its chat without opening it. 204: there is
// nothing to say back.
func (s *Service) handleRead(w http.ResponseWriter, r *http.Request) {
	room, me, ok := s.member(w, r)
	if !ok {
		return
	}
	s.markRead(r.Context(), room, me)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) markRead(ctx context.Context, room db.Room, me db.User) {
	if err := s.store.Queries.MarkRoomRead(ctx, db.MarkRoomReadParams{
		RoomID: room.ID, UserID: me.ID,
	}); err != nil {
		s.log.Warn("mark room read failed", "err", err, "room", room.Slug)
	}
}
