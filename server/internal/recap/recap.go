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
	"fmt"
	"log/slog"
	"time"

	"github.com/natrontech/wattroom/server/internal/retry"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
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
	riders, err := json.Marshal(rec.Riders)
	if err != nil {
		s.log.Error("recap riders encode", "err", err, "room", slug)
		return
	}
	// Retried like the ride save (#235): a database blip at session close
	// used to lose the card for good — the room was already marked saved,
	// and ADR-0034 promises one recap per session (audit 2026-09-09). The
	// write is an upsert on (room, started_at), so a retry after a lost
	// answer lands on the row it already made.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var id pgtype.UUID
	err = retry.Do(ctx, s.log, "session recap "+slug, 5, time.Second, 5*time.Second, func(ctx context.Context) error {
		room, err := s.store.Queries.GetRoomBySlug(ctx, slug)
		if err != nil {
			return fmt.Errorf("room lookup: %w", err)
		}
		row, err := s.store.Queries.SaveSessionRecap(ctx, db.SaveSessionRecapParams{
			RoomID:    room.ID,
			Workout:   rec.Workout,
			StartedAt: stamp(rec.StartedAt),
			EndedAt:   stamp(rec.EndedAt),
			Riders:    riders,
		})
		if err != nil {
			return err
		}
		id = row.ID
		return nil
	})
	if err != nil {
		s.log.Error("save recap failed, recap lost", "err", err, "room", slug)
		return
	}
	rec.ID = store.UUIDString(id)
	if s.live != nil {
		s.live.PostRecap(slug, rec)
	}
}

// List is a room's recaps for the chat backlog, oldest-first — the caller has
// already proven membership, which is the only gate this data has.
//
// viewer is whose own ride each card points at (#1560). It narrows nothing
// else: every member sees the same presence intervals, and the ride id is the
// one per-viewer field on the card.
func (s *Service) List(ctx context.Context, roomID, viewer pgtype.UUID, limit int) ([]protocol.SessionRecap, error) {
	rows, err := s.store.Queries.ListRoomRecaps(ctx, db.ListRoomRecapsParams{
		RoomID: roomID, Limit: int32(limit), UserID: viewer, //nolint:gosec // bounded by the caller
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
		if row.MyRideID.Valid {
			rec.RideID = store.UUIDString(row.MyRideID)
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
