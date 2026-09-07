// Package recap is the durable half of a finished session (ADR-0034): one row
// per session saying who was in the room and for how long. The live path still
// rides the hub's tick; this package only remembers.
//
// It is deliberately the narrowest durable thing in the app. Presence and time
// only — no watts, no kJ, no execution, no heart rate, no per-rider workout —
// because everyone in the room already watched the roster, while a metric
// handed to everyone permanently is what WATTROOM.md locks.
package recap

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// RetentionDays is docs/SPEC.md's number: long enough to answer "who rode with
// us last month", short enough to stop answering "where was this person in
// March". A room is a crew, not an attendance register.
const RetentionDays = 90

// Live is what recap borrows from the hub: the stored row still has to reach
// the riders standing in the room, on the tick after it lands, so the card
// appears when the session ends rather than on their next join. Optional —
// without it the recap is simply read from the backlog.
type Live interface {
	PostRecap(slug string, recap protocol.SessionRecap)
}

type Service struct {
	store *store.Store
	log   *slog.Logger
	live  Live
}

func New(st *store.Store, log *slog.Logger) *Service {
	return &Service{store: st, log: log}
}

// SetLive wires the hub in after construction — the hub needs this service
// first, as its RecapKeeper.
func (s *Service) SetLive(l Live) { s.live = l }

// SaveRecap implements hub.RecapKeeper: write the row, hand it back to the
// room with the id the store gave it. Called on its own goroutine from the
// tick, so this owns its budget and never blocks a room.
func (s *Service) SaveRecap(slug string, rec protocol.SessionRecap) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	room, err := s.store.Queries.GetRoomBySlug(ctx, slug)
	if err != nil {
		s.log.Warn("recap room lookup", "err", err, "room", slug)
		return
	}
	riders, err := json.Marshal(rec.Riders)
	if err != nil {
		s.log.Error("recap riders encode", "err", err, "room", slug)
		return
	}
	row, err := s.store.Queries.SaveSessionRecap(ctx, db.SaveSessionRecapParams{
		RoomID:    room.ID,
		Workout:   rec.Workout,
		StartedAt: stamp(rec.StartedAt),
		EndedAt:   stamp(rec.EndedAt),
		Riders:    riders,
	})
	if err != nil {
		s.log.Warn("save recap", "err", err, "room", slug)
		return
	}
	rec.ID = store.UUIDString(row.ID)
	if s.live != nil {
		s.live.PostRecap(slug, rec)
	}
	s.prune(slug)
}

// prune enforces the retention bound on write, the way chat enforces its
// 500-line one: the table cannot grow past the promise, and nothing needs a
// scheduler. Sessions end rarely enough that this needs no sampling.
func (s *Service) prune(slug string) {
	// Detached deliberately: the sweep must outlive the write that triggered
	// it, and it is bounded by the timeout below.
	safego.Go(s.log, "recap prune "+slug, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := s.store.Queries.PruneSessionRecaps(ctx, RetentionDays); err != nil {
			s.log.Warn("prune recaps", "err", err)
		}
	})
}

// List is a room's recaps for the chat backlog, oldest-first — the caller has
// already proven membership, which is the only gate this data has.
func (s *Service) List(ctx context.Context, roomID pgtype.UUID, limit int) ([]protocol.SessionRecap, error) {
	rows, err := s.store.Queries.ListRoomRecaps(ctx, db.ListRoomRecapsParams{
		RoomID: roomID, Limit: int32(limit), //nolint:gosec // bounded by the caller
	})
	if err != nil {
		return nil, err
	}
	out := make([]protocol.SessionRecap, 0, len(rows))
	for _, row := range rows {
		rec := protocol.SessionRecap{
			ID:        store.UUIDString(row.ID),
			Workout:   row.Workout,
			StartedAt: row.StartedAt.Time.UnixMilli(),
			EndedAt:   row.EndedAt.Time.UnixMilli(),
		}
		// A row whose riders will not parse is a row we cannot draw. Skip it
		// rather than failing the whole backlog: the conversation matters
		// more than one card (errors.md — never a blank pane).
		if err := json.Unmarshal(row.Riders, &rec.Riders); err != nil {
			s.log.Warn("recap riders decode", "err", err, "recap", rec.ID)
			continue
		}
		out = append(out, rec)
	}
	return out, nil
}

func stamp(millis int64) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.UnixMilli(millis), Valid: true}
}
