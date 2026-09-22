// Package chat is the durable half of room chat (ADR-0010 amended, #201):
// a bounded room log — last 500 messages, pruned on write — plus reactions.
// The live path still rides the hub's tick; this package only remembers.
package chat

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

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
	List(ctx context.Context, roomID, viewer pgtype.UUID, limit int) ([]protocol.SessionRecap, error)
}

// Live is what chat borrows from the hub: the lobby ping. Chat left the tick
// (#2437), so every write — a line, an edit, a deletion, a reaction — pings,
// and whoever is showing the room re-reads its backlog; a sidebar's unread
// count moves on the same ping (#568). Optional: without it the change is
// read on the next fetch.
type Live interface {
	PresenceChanged()
}

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
	// A text channel's gate and its fan-out (#2435), set by RegisterChannels.
	channels Channels
	lobby    Lobby
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

// tooLong answers 400 when a line is over the one cap this app has. The
// number is protocol.MaxMessageChars in the check AND in the sentence: this
// door used to declare its own 500 and tell the rider about a third one, and
// protocol/limits.go exists because that is how #1393 and #1986 happened.
func tooLong(w http.ResponseWriter, text string) bool {
	if utf8.RuneCountInString(text) <= protocol.MaxMessageChars {
		return false
	}
	httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
		fmt.Sprintf("That message is too long — %d characters is the cap.", protocol.MaxMessageChars), "text")
	return true
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
	mux.HandleFunc("DELETE /api/rooms/{slug}/chat/{id}", s.handleDelete)
	mux.HandleFunc("POST /api/rooms/{slug}/chat/reactions", s.handleReact)
	mux.HandleFunc("POST /api/rooms/{slug}/read", s.handleRead)
	mux.HandleFunc("POST /api/rooms/{slug}/chat/images", s.handleImageUpload)
	mux.HandleFunc("GET /api/rooms/{slug}/chat/images/{id}", s.handleImage)
}

// saveChat persists one line and prunes, handing back the id reactions
// attach to. imageID is optional (#279) — a blob the sender uploaded first;
// junk parses to NULL. at is the line's own millisecond, written rather than
// defaulted (#2421): the row and the response name the same moment.
func (s *Service) saveChat(ctx context.Context, roomID pgtype.UUID, where, userID, text, imageID string, at int64) (string, bool) {
	uid, err := store.ParseUUID(userID)
	if err != nil {
		return "", false
	}
	img, _ := store.ParseUUID(imageID) // zero value = NULL — image-less line
	id, err := s.store.Queries.SaveChatMessage(ctx, db.SaveChatMessageParams{
		RoomID: roomID, UserID: uid, Text: text, ImageID: img,
		CreatedAt: pgtype.Timestamptz{Time: time.UnixMilli(at), Valid: true},
	})
	if err != nil {
		s.log.Warn("save chat", "err", err, "room", where)
		return "", false
	}
	s.pruneSampled(roomID, where)
	return store.UUIDString(id), true
}

// pruneSampled runs the room's bounds off the hot path, one write in sixteen:
// every save used to pay a delete-with-subquery that stalled the sender's own
// read loop (audit #219). Called from both writes that can grow a room —
// a chat line and an image upload.
func (s *Service) pruneSampled(roomID pgtype.UUID, where string) {
	if time.Now().UnixNano()%16 != 0 {
		return
	}
	// The prune must outlive the request — deliberate detachment, bounded below.
	safego.Go(s.log, "chat prune "+where, func() {
		pctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.store.Queries.PruneChat(pctx, roomID); err != nil {
			s.log.Warn("prune chat", "err", err, "room", where)
		}
		// Blobs ride the same bound (#279): unreferenced after the prune
		// above (or never sent) → swept after a 15-minute grace.
		if err := s.store.Queries.PruneChatImages(pctx, roomID); err != nil {
			s.log.Warn("prune chat images", "err", err, "room", where)
		}
	})
}

// toggleReaction adds the emoji if absent, removes it if present, and
// returns the new total. The insert refuses messages outside this room.
func (s *Service) toggleReaction(ctx context.Context, roomID pgtype.UUID, where, messageID, userID, emoji string) (int, bool, bool) {
	uid, err := store.ParseUUID(userID)
	if err != nil {
		return 0, false, false
	}
	mid, err := store.ParseUUID(messageID)
	if err != nil {
		return 0, false, false
	}
	added, err := s.store.Queries.AddChatReaction(ctx, db.AddChatReactionParams{
		MessageID: mid, UserID: uid, Emoji: emoji, RoomID: roomID,
	})
	if err != nil {
		s.log.Warn("add reaction", "err", err, "room", where)
		return 0, false, false
	}
	if added == 0 {
		removed, err := s.store.Queries.RemoveChatReaction(ctx, db.RemoveChatReactionParams{
			MessageID: mid, UserID: uid, Emoji: emoji, RoomID: roomID,
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
