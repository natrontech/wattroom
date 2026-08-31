package stats

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// RideUploader pushes a saved ride to an external service (#34's Strava
// worker) — defined here, where it is consumed; nil means "feature absent".
type RideUploader interface {
	RideSaved(rideID pgtype.UUID)
}

type Saver struct {
	store    *store.Store
	log      *slog.Logger
	uploader RideUploader
}

func NewSaver(st *store.Store, log *slog.Logger) *Saver {
	return &Saver{store: st, log: log}
}

// SetUploader wires the worker in after construction (nil-safe: never store
// a typed-nil in the interface).
func (s *Saver) SetUploader(u RideUploader) { s.uploader = u }

// save persists every rider's ride in one transaction (docs/SPEC.md:
// stats compute on completion, in-process, <100 ms of math). Riders with
// fewer than a minute of samples are skipped — a misclick, not a ride, the
// same threshold the client's crash recovery uses.
func (s *Saver) save(
	ctx context.Context,
	roomSlug, workoutName, workoutJSON string,
	startedAt time.Time,
	riders []hub.RiderRecord,
) error {
	room, err := s.store.Queries.GetRoomBySlug(ctx, strings.ToLower(roomSlug))
	if err != nil {
		return fmt.Errorf("stats: room %q: %w", roomSlug, err)
	}

	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("stats: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.store.Queries.WithTx(tx)

	segments, _ := workout.Parse(workoutJSON)
	saved := 0
	results := make([]RiderResult, 0, len(riders))
	rideIDs := make(map[string]pgtype.UUID)
	for join, rider := range riders {
		if len(rider.Samples) < 60 {
			continue
		}
		row, err := s.rideRow(room.ID, workoutName, workoutJSON, startedAt, rider)
		if err != nil {
			// One rider's junk must not eat the whole room's rides.
			s.log.Warn("ride skipped", "err", err, "rider", rider.Rider.ID)
			continue
		}
		row.Xp += StreakXP(ctx, q, row.UserID, startedAt)
		rideID, err := q.CreateRide(ctx, row)
		if err != nil {
			return fmt.Errorf("stats: insert ride: %w", err)
		}
		saved++
		rideIDs[rider.Rider.ID] = rideID

		watts := make([]int, len(rider.Samples))
		for i, sample := range rider.Samples {
			watts[i] = sample.Watts
		}
		curve := PowerCurve(watts)
		wkg := 0.0
		if rider.Rider.WeightKg > 0 {
			wkg = float64(curve.Best5s) / float64(rider.Rider.WeightKg)
		}
		results = append(results, RiderResult{
			UserID: rider.Rider.ID, JoinOrder: join,
			Execution: float64(row.Execution),
			CoV:       SteadyCoV(segments, watts),
			Best5sWkg: wkg,
			Completed: true,
		})
	}

	// Medals in the same transaction (#28): the session either closes with its
	// medals or without its rides — never half.
	for kind, userID := range Medals(results) {
		uid, err := store.ParseUUID(userID)
		if err != nil {
			continue
		}
		err = q.CreateMedal(ctx, db.CreateMedalParams{
			RoomID: room.ID, UserID: uid, RideID: rideIDs[userID], Kind: kind,
		})
		if err != nil {
			return fmt.Errorf("stats: medal: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("stats: commit: %w", err)
	}
	if s.uploader != nil {
		for _, id := range rideIDs {
			s.uploader.RideSaved(id)
		}
	}
	s.log.Info("session saved", "room", roomSlug, "rides", saved)
	return nil
}

func (s *Saver) rideRow(
	roomID pgtype.UUID,
	workoutName, workoutJSON string,
	startedAt time.Time,
	rider hub.RiderRecord,
) (db.CreateRideParams, error) {
	userID, err := store.ParseUUID(rider.Rider.ID)
	if err != nil {
		return db.CreateRideParams{}, err
	}
	return BuildRideRow(userID, roomID, workoutName, workoutJSON, startedAt,
		rider.Rider.FtpWatts, rider.Samples)
}

// BuildRideRow turns a finished sample series into the rides row — one
// implementation for room sessions (the hub's saver) and solo rides (the
// POST /api/rides endpoint). An invalid roomID stores NULL: a solo ride.
func BuildRideRow(
	userID, roomID pgtype.UUID,
	workoutName, workoutJSON string,
	startedAt time.Time,
	ftpWatts int,
	samples []protocol.RiderMetrics,
) (db.CreateRideParams, error) {
	watts := make([]int, len(samples))
	total := 0
	for i, sample := range samples {
		watts[i] = sample.Watts
		total += sample.Watts
	}
	execution, err := Execution(workoutJSON, float64(ftpWatts), watts)
	if err != nil {
		return db.CreateRideParams{}, err
	}
	curve := PowerCurve(watts)
	curveJSON, err := json.Marshal(curve)
	if err != nil {
		return db.CreateRideParams{}, err
	}
	kj := total / 1000

	// The blob is the samples as JSON, gzipped — ~50 KB/h (WATTROOM.md §3),
	// readable back without a bespoke format.
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if err := json.NewEncoder(zw).Encode(samples); err != nil {
		return db.CreateRideParams{}, err
	}
	if err := zw.Close(); err != nil {
		return db.CreateRideParams{}, err
	}

	normWatts := int16(NormPower(watts)) //nolint:gosec // samples bounded 0-3000
	return db.CreateRideParams{
		UserID:      userID,
		RoomID:      roomID,
		WorkoutName: workoutName,
		StartedAt:   pgtype.Timestamptz{Time: startedAt, Valid: true},
		Seconds:     int32(len(samples)),                        //nolint:gosec // bounded by maxAccumulated
		AvgWatts:    int16((total + len(watts)/2) / len(watts)), //nolint:gosec // samples bounded 0-3000
		Kj:          int32(kj),                                  //nolint:gosec // bounded by seconds*3000/1000
		Execution:   float32(execution),
		FtpWatts:    int16(ftpWatts), //nolint:gosec // schema-bounded 50-600
		Samples:     buf.Bytes(),
		Curve:       curveJSON,
		Xp:          int32(XP(kj, execution)), //nolint:gosec // bounded by kj
		NormWatts:   &normWatts,
	}, nil
}

// StreakXP is the SPEC XP streak term, deferred from #25: the rider's own
// consecutive-week streak, read before this ride lands so this week only
// counts if already ridden — then this ride extends it next time. A read
// failure is zero bonus, never a failed save.
func StreakXP(ctx context.Context, q *db.Queries, userID pgtype.UUID, at time.Time) int32 {
	weeks, err := q.ListUserRideWeeks(ctx, userID)
	if err != nil {
		return 0
	}
	times := make([]time.Time, len(weeks))
	for i, w := range weeks {
		times[i] = w.Time
	}
	return int32(StreakBonus(WeekStreak(times, at))) //nolint:gosec // capped at 250
}

// Retry policy for session saves (#235): a Postgres blip at session close
// must not eat the room's rides. save is one transaction, so a failed attempt
// leaves nothing behind and retrying is safe. Doubling backoff sums to ~2 min
// of waits — enough for a restart or failover; a longer outage loses the
// rides, logged loudly below.
const (
	saveAttempts   = 8
	retryBase      = time.Second
	attemptTimeout = 10 * time.Second
)

// SaveSession implements hub.SessionSaver. The hub cannot act on a failure,
// so the retry policy lives here and the tick loop never learns.
func (s *Saver) SaveSession(
	ctx context.Context,
	slug, workoutName, workoutJSON string,
	startedAt time.Time,
	riders []hub.RiderRecord,
) {
	err := retrySave(ctx, s.log, slug, func(ctx context.Context) error {
		return s.save(ctx, slug, workoutName, workoutJSON, startedAt, riders)
	})
	if err != nil {
		s.log.Error("session save failed, rides lost", "err", err, "room", slug)
	}
}

// retrySave runs save with a per-attempt timeout and doubling backoff until
// it succeeds, attempts run out, or ctx is cancelled — returning the last
// attempt's error.
func retrySave(
	ctx context.Context,
	log *slog.Logger,
	room string,
	save func(context.Context) error,
) error {
	wait := retryBase
	for attempt := 1; ; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, attemptTimeout)
		err := save(attemptCtx)
		cancel()
		if err == nil || attempt == saveAttempts {
			return err
		}
		log.Warn("session save failed, retrying",
			"err", err, "room", room, "attempt", attempt, "wait", wait)
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return err
		}
		wait *= 2
	}
}
