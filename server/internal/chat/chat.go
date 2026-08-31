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
	mux.HandleFunc("POST /api/rooms/{slug}/chat/images", s.handleImageUpload)
	mux.HandleFunc("GET /api/rooms/{slug}/chat/images/{id}", s.handleImage)
}

// SaveChat implements hub.ChatKeeper: persist, prune, hand back the identity
// the tick line carries so reactions have something to attach to. imageID is
// optional (#279) — a blob the sender uploaded first; junk parses to NULL.
func (s *Service) SaveChat(ctx context.Context, slug, userID, text, imageID string) (string, bool) {
	// Runs on the hub's save worker (#219), so a stalled database backs up
	// that queue — nobody's read loop. The budget just bounds the queue lag.
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	room, uid, ok := s.resolve(ctx, slug, userID)
	if !ok {
		return "", false
	}
	img, _ := store.ParseUUID(imageID) // zero value = NULL — image-less line
	id, err := s.store.Queries.SaveChatMessage(ctx, db.SaveChatMessageParams{
		RoomID: room.ID, UserID: uid, Text: text, ImageID: img,
	})
	if err != nil {
		s.log.Warn("save chat", "err", err, "room", slug)
		return "", false
	}
	s.pruneSampled(room.ID, slug)
	return store.UUIDString(id), true
}

// pruneSampled runs the room's bounds off the hot path, one write in sixteen:
// every save used to pay a delete-with-subquery that stalled the sender's own
// read loop (audit #219). Called from both writes that can grow a room —
// a chat line and an image upload.
func (s *Service) pruneSampled(roomID pgtype.UUID, slug string) {
	if time.Now().UnixNano()%16 != 0 {
		return
	}
	go func() { //nolint:gosec // the prune must outlive the request — deliberate detachment, bounded below
		pctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.store.Queries.PruneChat(pctx, roomID); err != nil {
			s.log.Warn("prune chat", "err", err, "room", slug)
		}
		// Blobs ride the same bound (#279): unreferenced after the prune
		// above (or never sent) → swept after a 15-minute grace.
		if err := s.store.Queries.PruneChatImages(pctx, roomID); err != nil {
			s.log.Warn("prune chat images", "err", err, "room", slug)
		}
	}()
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
	// A pasted image's blob id (#279) — rendered from the images endpoint.
	ImageID string `json:"imageId,omitempty"`
	At      int64  `json:"at"`
	// emoji → count, plus which the viewer pressed — same shape the live
	// path builds client-side, so the panel renders one way.
	Reactions map[string]int `json:"reactions,omitempty"`
	Mine      []string       `json:"mine,omitempty"`
}

// member gates a chat endpoint: signed in, room exists, requester belongs —
// chat never leaves the room (ADR-0010), and neither do its images.
func (s *Service) member(w http.ResponseWriter, r *http.Request) (db.Room, db.User, bool) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.Room{}, db.User{}, false
	}
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), r.PathValue("slug"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such room.")
		return db.Room{}, db.User{}, false
	}
	if _, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: me.ID,
	}); err != nil {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Chat is for the room's members.")
		return db.Room{}, db.User{}, false
	}
	return room, me, true
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
		s.log.Error("save chat image", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The image could not be saved.")
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
	w.Header().Set("Content-Type", img.Mime)
	// These are member-supplied bytes served from the app's own origin: a
	// polyglot that passes the upload sniff as an image must never be
	// re-interpreted as HTML by the browser.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = w.Write(img.Bytes)
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
			ImageID:   store.UUIDString(row.ImageID), // "" when the line has none
			At:        row.CreatedAt.Time.UnixMilli(),
			Reactions: counts[id], Mine: mine[id],
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"messages": out})
}
