// Package chat is a text channel's durable log (ADR-0058, #2435): the last
// 500 lines per channel, pruned on write, plus reactions, images, read marks
// and the one announcement a channel keeps. HTTP only; the fan-out is the
// lobby ping naming the channel.
package chat

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// The HTTP door's ceilings (#1982), the DM door's numbers: the socket path
// allows one line a second, and a door with no ceiling beside one with is
// the one a script uses.
const (
	linesPerMinute = 60
	uploadsPerHour = 60
)

type Service struct {
	store *store.Store
	log   *slog.Logger
	// A text channel's gate and its fan-out (#2435), set by RegisterChannels.
	channels Channels
	lobby    Lobby
	// Per account: posts, edits and reactions share one; uploads have their own.
	lines   *budget.Budget[pgtype.UUID]
	uploads *budget.Budget[pgtype.UUID]
}

func New(st *store.Store, log *slog.Logger) *Service {
	return &Service{
		store: st, log: log,
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
	// When a temporary line runs out (#2644); absent for one that stays.
	ExpiresAt int64 `json:"expiresAt,omitempty"`
	// emoji → count, plus which the viewer pressed — same shape the live
	// path builds client-side, so the panel renders one way.
	Reactions map[string]int `json:"reactions,omitempty"`
	Mine      []string       `json:"mine,omitempty"`
}
