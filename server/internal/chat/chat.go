// Package chat is the durable half of room chat (ADR-0010 amended, #201):
// a bounded room log — last 500 messages, pruned on write — plus reactions.
// The live path still rides the hub's tick; this package only remembers.
package chat

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Members is what chat borrows from rooms: the one membership gate every
// room-scoped surface stands behind (#638), satisfied by *rooms.Service.
type Members interface {
	RequireMember(w http.ResponseWriter, r *http.Request, refusal string) (db.Room, db.User, bool)
}

// Recaps is what the backlog borrows from the recap service (ADR-0034): the
// room's durable session cards, merged into the same timeline the messages
// are. One endpoint rather than two, because it is one question — "what has
// happened in this room?" — behind one membership gate that is already
// checked here. Optional: without it the timeline is messages and live
// events, exactly as before.
type Recaps interface {
	List(ctx context.Context, roomID pgtype.UUID, limit int) ([]protocol.SessionRecap, error)
}

// Live is what chat borrows from the hub (#468): a line or a reaction posted
// over HTTP by a member who is not in the room still has to reach the riders
// who are, on the next tick, as if it had come over their socket. Optional:
// without it the post is remembered and read on the next join.
type Live interface {
	PostChat(slug string, line protocol.ChatLine)
	PostReaction(slug string, change protocol.ChatReactionCount)
	PostChatEdit(slug string, edit protocol.ChatEdit)
}

// maxChatRunes is the cap the socket path and the client's maxlength agree on.
const maxChatRunes = 500

// The HTTP door's ceilings (#1982), the DM door's numbers: the socket path
// allows one line a second, and a door with no ceiling beside one with is
// the one a script uses.
const (
	linesPerMinute = 60
	uploadsPerHour = 60
)

type Service struct {
	store   *store.Store
	members Members
	log     *slog.Logger
	live    Live
	recaps  Recaps
	// Per account: posts, edits and reactions share one; uploads have their own.
	lines   *budget.Budget[pgtype.UUID]
	uploads *budget.Budget[pgtype.UUID]
}

func New(st *store.Store, members Members, log *slog.Logger) *Service {
	return &Service{
		store: st, members: members, log: log,
		lines:   budget.New[pgtype.UUID](linesPerMinute, time.Minute),
		uploads: budget.New[pgtype.UUID](uploadsPerHour, time.Hour),
	}
}

// overLine answers 429 when the account has written its minute's worth.
func (s *Service) overLine(w http.ResponseWriter, me pgtype.UUID) bool {
	if s.lines.Spend(me) {
		return false
	}
	httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
		"That is a lot of lines in one minute — a moment, then say it again.")
	return true
}

// SetLive wires the hub in after construction — the hub needs this service
// first, as its ChatKeeper.
func (s *Service) SetLive(l Live) { s.live = l }

// SetRecaps wires the session cards into the backlog (ADR-0034).
func (s *Service) SetRecaps(r Recaps) { s.recaps = r }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/rooms/{slug}/chat", s.handleBacklog)
	mux.HandleFunc("POST /api/rooms/{slug}/chat", s.handlePost)
	mux.HandleFunc("PATCH /api/rooms/{slug}/chat/{id}", s.handleEdit)
	mux.HandleFunc("POST /api/rooms/{slug}/chat/reactions", s.handleReact)
	mux.HandleFunc("POST /api/rooms/{slug}/read", s.handleRead)
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
	// The prune must outlive the request — deliberate detachment, bounded below.
	safego.Go(s.log, "chat prune "+slug, func() {
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
	})
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
	// When the author last rewrote it (#865); absent for a line as sent.
	EditedAt int64 `json:"editedAt,omitempty"`
	// emoji → count, plus which the viewer pressed — same shape the live
	// path builds client-side, so the panel renders one way.
	Reactions map[string]int `json:"reactions,omitempty"`
	Mine      []string       `json:"mine,omitempty"`
}
