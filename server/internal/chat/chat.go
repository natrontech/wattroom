// Package chat is the durable half of room chat (ADR-0010 amended, #201):
// a bounded room log — last 500 messages, pruned on write — plus reactions.
// The live path still rides the hub's tick; this package only remembers.
package chat

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

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
	mux.HandleFunc("GET /api/rooms/{slug}/chat", s.handleBacklog)
}

// SaveChat implements hub.ChatKeeper: persist, prune, hand back the identity
// the tick line carries so reactions have something to attach to.
func (s *Service) SaveChat(ctx context.Context, slug, userID, text string) (string, bool) {
	// Tight budget: this runs in the sender's read loop — a stalled database
	// must cost one line, not seconds of frozen metrics (#219).
	ctx, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
	defer cancel()
	room, uid, ok := s.resolve(ctx, slug, userID)
	if !ok {
		return "", false
	}
	id, err := s.store.Queries.SaveChatMessage(ctx, db.SaveChatMessageParams{
		RoomID: room.ID, UserID: uid, Text: text,
	})
	if err != nil {
		s.log.Warn("save chat", "err", err, "room", slug)
		return "", false
	}
	// Prune sampled and off the hot path: every save paid a delete-with-
	// subquery that stalled the sender's own read loop (audit #219).
	if time.Now().UnixNano()%16 == 0 {
		go func() { //nolint:gosec // the prune must outlive the request — deliberate detachment, bounded below
			pctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := s.store.Queries.PruneChat(pctx, room.ID); err != nil {
				s.log.Warn("prune chat", "err", err, "room", slug)
			}
		}()
	}
	return store.UUIDString(id), true
}

// ToggleReaction implements hub.ChatKeeper: add if absent, remove if present,
// return the new total. The insert refuses messages outside this room.
func (s *Service) ToggleReaction(ctx context.Context, slug, messageID, userID, emoji string) (int, bool, bool) {
	ctx, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
	defer cancel()
	room, uid, ok := s.resolve(ctx, slug, userID)
	if !ok {
		return 0, false, false
	}
	mid, err := store.ParseUUID(messageID)
	if err != nil {
		return 0, false, false
	}
	added, err := s.store.Queries.AddChatReaction(ctx, db.AddChatReactionParams{
		MessageID: mid, UserID: uid, Emoji: emoji, RoomID: room.ID,
	})
	if err != nil {
		s.log.Warn("add reaction", "err", err, "room", slug)
		return 0, false, false
	}
	if added == 0 {
		removed, err := s.store.Queries.RemoveChatReaction(ctx, db.RemoveChatReactionParams{
			MessageID: mid, UserID: uid, Emoji: emoji, RoomID: room.ID,
		})
		if err != nil || removed == 0 {
			// Neither added nor removed: the message is not in this room.
			return 0, false, false
		}
	}
	count, err := s.store.Queries.CountChatReaction(ctx, db.CountChatReactionParams{
		MessageID: mid, Emoji: emoji,
	})
	if err != nil {
		return 0, false, false
	}
	return int(count), added > 0, true
}

func (s *Service) resolve(ctx context.Context, slug, userID string) (db.Room, pgtype.UUID, bool) {
	uid, err := store.ParseUUID(userID)
	if err != nil {
		return db.Room{}, pgtype.UUID{}, false
	}
	room, err := s.store.Queries.GetRoomBySlug(ctx, slug)
	if err != nil {
		return db.Room{}, pgtype.UUID{}, false
	}
	return room, uid, true
}

type messageJSON struct {
	ID   string `json:"id"`
	From string `json:"from"`
	// The author's rider id — the same field live tick lines carry (#219),
	// so backlog and live render (and self-suppress) identically.
	FromID string `json:"fromId"`
	Text   string `json:"text"`
	At     int64  `json:"at"`
	// emoji → count, plus which the viewer pressed — same shape the live
	// path builds client-side, so the panel renders one way.
	Reactions map[string]int `json:"reactions,omitempty"`
	Mine      []string       `json:"mine,omitempty"`
}

// handleBacklog is the join-time load: the newest lines, oldest first,
// members only — chat never leaves the room (ADR-0010).
func (s *Service) handleBacklog(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), r.PathValue("slug"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such room.")
		return
	}
	if _, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: me.ID,
	}); err != nil {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Chat is for the room's members.")
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
		s.log.Error("list chat", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The chat could not be loaded.")
		return
	}
	reactions, err := s.store.Queries.ListChatReactions(r.Context(), db.ListChatReactionsParams{
		RoomID: room.ID, UserID: me.ID,
	})
	if err != nil {
		s.log.Error("list reactions", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The chat could not be loaded.")
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
			At:        row.CreatedAt.Time.UnixMilli(),
			Reactions: counts[id], Mine: mine[id],
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"messages": out})
}
