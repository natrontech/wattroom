package stats

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/retry"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// RideUploader pushes a saved ride to an external service (#34's Strava
// worker) — defined here, where it is consumed; nil means "feature absent".
type RideUploader interface {
	RideSaved(rideID pgtype.UUID)
}

// RideKeeper hears about every saved ride (#467): the trophy case judges ride
// achievements from the samples in hand, because rides store no zone seconds.
// Defined here, where it is consumed; nil means no gamification. Called after
// the commit and expected to return at once — the keeper queues its own I/O.
type RideKeeper interface {
	RideSaved(userID pgtype.UUID, facts RideFacts)
}

type Saver struct {
	store    *store.Store
	log      *slog.Logger
	uploader RideUploader
	keeper   RideKeeper
}

func NewSaver(st *store.Store, log *slog.Logger) *Saver {
	return &Saver{store: st, log: log}
}

// SetUploader wires the worker in after construction (nil-safe: never store
// a typed-nil in the interface).
func (s *Saver) SetUploader(u RideUploader) { s.uploader = u }

// SetRideKeeper wires the trophy case in the same way.
func (s *Saver) SetRideKeeper(k RideKeeper) { s.keeper = k }

// savedRide is one ride the keeper hears about once the transaction holds.
type savedRide struct {
	rideID pgtype.UUID
	userID pgtype.UUID
	facts  RideFacts
}

// save persists every rider's ride in one transaction (docs/SPEC.md:
// stats compute on completion, in-process, <100 ms of math). Riders with
// fewer than a minute of samples are skipped — a misclick, not a ride, the
// same threshold the client's crash recovery uses.
func (s *Saver) save(
	ctx context.Context,
	channel, session, workoutName, workoutJSON string,
	startedAt time.Time,
	riders []hub.RiderRecord,
) error {
	at, err := s.placeOf(ctx, channel, session)
	if err != nil {
		return err
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
	alreadySaved := map[string]bool{}
	kept := make([]savedRide, 0, len(riders))
	for join, rider := range riders {
		if len(rider.Samples) < hub.MinRideSamples {
			continue
		}
		start := rideStart(startedAt, rider)
		row, err := s.rideRow(workoutName, workoutJSON, start, rider)
		if err != nil {
			// One rider's junk must not eat the whole room's rides.
			s.log.Warn("ride skipped", "err", err, "rider", rider.Rider.ID)
			continue
		}
		row.CrewID, row.ChannelID, row.SessionID = at.crew, at.channel, at.session
		row.Xp += StreakXP(ctx, q, row.UserID, start)
		// A retry after a commit whose answer was lost must not insert the
		// rider's ride — or their medals — twice (audit 2026-09-09).
		if existing, err := q.FindRideAt(ctx, db.FindRideAtParams{UserID: row.UserID, StartedAt: row.StartedAt}); err == nil {
			s.log.Info("ride already saved", "rider", rider.Rider.ID, "ride", store.UUIDString(existing))
			rideIDs[rider.Rider.ID] = existing
			alreadySaved[rider.Rider.ID] = true
			continue
		}
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
		kept = append(kept, savedRide{
			rideID: rideID, userID: row.UserID, facts: Facts(start, rider.Rider.FtpWatts, watts),
		})
		curve := PowerCurve(watts)
		wkg := 0.0
		if rider.Rider.WeightKg > 0 {
			wkg = float64(curve.Best5s) / float64(rider.Rider.WeightKg)
		}
		// By the workout second, not the sample's place in the record (#2814):
		// a rider who joined late would otherwise be judged on the blocks of
		// minute 0, and never reach the last one.
		timeline := onTimeline(rider.Samples)
		results = append(results, RiderResult{
			UserID: rider.Rider.ID, JoinOrder: join,
			Execution: float64(row.Execution),
			Scored:    row.ExecutionScored,
			CoV:       SteadyCoV(segments, timeline),
			Best5sWkg: wkg,
			Completed: Completed(segments, len(timeline)),
		})
	}

	// Medals in the same transaction (#28): the session either closes with its
	// medals or without its rides — never half.
	for kind, userID := range Medals(results) {
		uid, err := store.ParseUUID(userID)
		// A medal is a crew's: a session in a channel deleted before it
		// closed belongs to none, and the rides are saved alone.
		if err != nil || alreadySaved[userID] || !at.crew.Valid {
			continue
		}
		err = q.CreateMedal(ctx, db.CreateMedalParams{
			CrewID: at.crew, UserID: uid, RideID: rideIDs[userID], Kind: kind,
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
	if s.keeper != nil {
		for _, ride := range kept {
			s.keeper.RideSaved(ride.userID, ride.facts)
		}
	}
	s.log.Info("session saved", "channel", channel, "rides", saved)
	return nil
}

// place is where a session's rides were ridden (#2443): its crew, its voice
// channel and the session itself. Never a room (#2558).
type place struct{ crew, channel, session pgtype.UUID }

// placeOf resolves the channel the hub names. A channel that is gone — deleted
// while the session ran — is nowhere, and its rides are saved all the same: a
// ride is the rider's, and nobody ever loses one (WATTROOM.md).
func (s *Saver) placeOf(ctx context.Context, channel, session string) (place, error) {
	var at place
	id, err := store.ParseUUID(channel)
	if err != nil {
		return at, nil
	}
	ch, err := s.store.Queries.GetChannel(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return at, nil
	}
	if err != nil {
		return at, fmt.Errorf("stats: channel %q: %w", channel, err)
	}
	at.crew, at.channel = ch.CrewID, ch.ID
	// Empty for a session that came back from a restart without one.
	at.session, _ = store.ParseUUID(session)
	return at, nil
}

// rideStart is when a session rider's ride began: the hub's own answer
// (#2814), the session's start for a record that carries none.
func rideStart(session time.Time, rider hub.RiderRecord) time.Time {
	if rider.StartedAt.IsZero() {
		return session
	}
	return rider.StartedAt
}

func (s *Saver) rideRow(
	workoutName, workoutJSON string,
	startedAt time.Time,
	rider hub.RiderRecord,
) (db.CreateRideParams, error) {
	userID, err := store.ParseUUID(rider.Rider.ID)
	if err != nil {
		return db.CreateRideParams{}, err
	}
	return BuildRideRow(userID, workoutName, workoutJSON, startedAt,
		rider.Rider.FtpWatts, rider.Samples)
}

// BuildRideRow turns a finished sample series into the rides row — one
// implementation for sessions (the hub's saver, which adds where it was
// ridden) and solo rides (the POST /api/rides endpoint).
func BuildRideRow(
	userID pgtype.UUID,
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
	execution, scorable, err := Execution(workoutJSON, float64(ftpWatts), samples)
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
	// SPEC's LTHR-from-a-ride input (#1620), computed here because the blob is
	// already in hand; 0 on a ride with no last-20-minute heart rate. Clamped
	// only to what the column can hold — a reading's sanity is the
	// suggestion's business (SuggestLTHR), not storage's.
	lastHR := int16(min(Last20mHR(samples), math.MaxInt16)) //nolint:gosec // clamped on the line
	return db.CreateRideParams{
		UserID:      userID,
		WorkoutName: workoutName,
		StartedAt:   pgtype.Timestamptz{Time: startedAt, Valid: true},
		Seconds:     int32(len(samples)),                        //nolint:gosec // bounded by maxAccumulated
		AvgWatts:    int16((total + len(watts)/2) / len(watts)), //nolint:gosec // samples bounded 0-3000
		Kj:          int32(kj),                                  //nolint:gosec // bounded by seconds*3000/1000
		Execution:   float32(execution),
		// #1143: a ride whose workout prescribed nothing has no execution, and
		// 0 would read as "executed none of it" rather than "nothing to do".
		ExecutionScored: scorable,
		FtpWatts:        int16(ftpWatts), //nolint:gosec // schema-bounded 50-600
		Samples:         buf.Bytes(),
		Curve:           curveJSON,
		Xp:              int32(XP(kj, execution)), //nolint:gosec // bounded by kj
		NormWatts:       &normWatts,
		Last20mHr:       &lastHR,
	}, nil
}

// DecodeSamples reads a blob BuildRideRow wrote, and is the only place that
// knows the format on the way back — the norm backfill, the Strava upload and
// the ride detail endpoint all come through here rather than each opening
// their own gzip reader.
func DecodeSamples(blob []byte) ([]protocol.RiderMetrics, error) {
	zr, err := gzip.NewReader(bytes.NewReader(blob))
	if err != nil {
		return nil, fmt.Errorf("stats: sample blob: %w", err)
	}
	defer func() { _ = zr.Close() }()
	var samples []protocol.RiderMetrics
	// The blob was written by us and is size-bounded at write time.
	if err := json.NewDecoder(zr).Decode(&samples); err != nil {
		return nil, fmt.Errorf("stats: sample blob: %w", err)
	}
	return samples, nil
}

// StreakXP is the SPEC XP streak term, deferred from #25: the rider's own
// consecutive-week streak, read before this ride lands so this week only
// counts if already ridden — then this ride extends it next time. A read
// failure is zero bonus, never a failed save.
//
// The week is the rider's own (#2063), which is why the zone is read here
// rather than at the three call sites: a session save has the rider's hub
// identity, not their user row, and the query and WeekStreak have to bucket
// in the same zone or the streak breaks on the seam between them. An
// unreadable zone is UTC, not a lost bonus.
func StreakXP(ctx context.Context, q *db.Queries, userID pgtype.UUID, at time.Time) int32 {
	return streakXPExcept(ctx, q, userID, at, pgtype.UUID{})
}

// streakXPExcept is StreakXP for a ride that is ALREADY in the table (#2253):
// an amendment reads after the row landed, so without this the ride's own
// week came back, the streak was one higher than the identical ride would
// have earned, and the amended row was written with the difference. Excluding
// the ride rather than its week keeps the question the same one save asks —
// a second ride in the same week still counts.
func streakXPExcept(ctx context.Context, q *db.Queries, userID pgtype.UUID, at time.Time, except pgtype.UUID) int32 {
	tz, err := q.UserTimezone(ctx, userID)
	if err != nil {
		tz = nil
	}
	weeks, err := q.ListUserRideWeeks(ctx, db.ListUserRideWeeksParams{
		UserID: userID, Tz: ZoneName(tz), ExceptID: except,
	})
	if err != nil {
		return 0
	}
	times := make([]time.Time, len(weeks))
	for i, w := range weeks {
		times[i] = w.Time
	}
	return int32(StreakBonus(WeekStreak(times, at, Zone(tz)))) //nolint:gosec // capped at 250
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
	channel, session, workoutName, workoutJSON string,
	startedAt time.Time,
	riders []hub.RiderRecord,
) {
	err := retrySave(ctx, s.log, channel, func(ctx context.Context) error {
		return s.save(ctx, channel, session, workoutName, workoutJSON, startedAt, riders)
	})
	if err != nil {
		s.log.Error("session save failed, rides lost", "err", err, "channel", channel)
	}
}

// AmendRide grows a saved ride from a longer record (#1536): a socket that
// dropped before the close and replayed its buffer after it used to land
// samples nothing read again. The row is rebuilt from the whole record —
// only when it grew — its xp moves by the difference (user_total_xp sums
// rides.xp live), and the medals stay as awarded: they were announced in
// the room. A rider with no ride to grow (under a minute at the close) is
// the client's to offer back as a .fit.
//
// The ride it grows already names its crew, channel and session; the
// amendment moves only its numbers.
func (s *Saver) AmendRide(
	ctx context.Context,
	channel, _, workoutName, workoutJSON string,
	startedAt time.Time,
	rider hub.RiderRecord,
) {
	if len(rider.Samples) < hub.MinRideSamples {
		return
	}
	// Set inside the closure when the ride actually grew, acted on after the
	// write settles — the same order save uses, and the reason neither the
	// trophy case nor the delivery mark is called in there: a retry re-runs
	// the closure, and the amendment it would re-run is a no-op the second
	// time round, so a failure in there would judge twice or lose the mark.
	var judged *savedRide
	err := retrySave(ctx, s.log, channel, func(ctx context.Context) error {
		judged = nil
		start := rideStart(startedAt, rider)
		row, err := s.rideRow(workoutName, workoutJSON, start, rider)
		if err != nil {
			s.log.Warn("ride amendment skipped", "err", err, "rider", rider.Rider.ID)
			return nil
		}
		q := s.store.Queries
		existing, err := q.FindRideAt(ctx, db.FindRideAtParams{UserID: row.UserID, StartedAt: row.StartedAt})
		if err != nil {
			s.log.Info("no ride to amend", "channel", channel, "rider", rider.Rider.ID)
			return nil
		}
		// The ride is already in the table, so the streak is read without it.
		row.Xp += streakXPExcept(ctx, q, row.UserID, start, existing)
		grown, err := q.AmendRide(ctx, db.AmendRideParams{
			ID: existing, Seconds: row.Seconds, AvgWatts: row.AvgWatts, Kj: row.Kj,
			Execution: row.Execution, ExecutionScored: row.ExecutionScored,
			Samples: row.Samples, Curve: row.Curve, Xp: row.Xp, NormWatts: row.NormWatts,
		})
		if err != nil {
			return fmt.Errorf("stats: amend ride: %w", err)
		}
		if grown > 0 {
			s.log.Info("ride amended", "channel", channel, "ride", store.UUIDString(existing), "samples", len(rider.Samples))
			watts := make([]int, len(rider.Samples))
			for i, sample := range rider.Samples {
				watts[i] = sample.Watts
			}
			judged = &savedRide{
				rideID: existing, userID: row.UserID,
				facts: Facts(start, rider.Rider.FtpWatts, watts),
			}
		}
		return nil
	})
	if err != nil {
		s.log.Error("ride amendment failed, tail lost", "err", err, "channel", channel)
		return
	}
	if judged == nil {
		return
	}
	// Strava already has the short ride, and nothing will ever re-send it
	// (#2281): StartRideExport does not re-open a delivered row, and the
	// upload API has no update to re-post through — a second post of the
	// same external_id is refused as a duplicate, which lands as a failed
	// delivery. So the divergence is recorded and the ride page says it.
	// A delivery still pending needs no mark: the upload that follows
	// carries the grown ride, which is the query's `state = 'delivered'`.
	if err := s.store.Queries.MarkRideExportStale(ctx, judged.rideID); err != nil {
		// Worth a loud line and not a lost amendment: the ride itself is
		// saved, and all that is missing is the sentence about Strava.
		s.log.Error("ride export stale mark failed", "err", err,
			"ride", store.UUIDString(judged.rideID))
	}
	// The tail is part of the ride, so the ride is judged on all of it
	// (#2252). facts.go: "Rides store no zone seconds, so this is the only
	// moment they exist" — a ride that grew from 40 to 50 minutes above FTP
	// was judged on the 40 and never looked at again. Judging is idempotent
	// (gamify: a second call re-earns nothing), so the trophies the short
	// version already won stay won.
	if s.keeper != nil {
		s.keeper.RideSaved(judged.userID, judged.facts)
	}
}

// retrySave is retry.Do with the saver's own policy (#235), kept as a name
// so the tests and the call site read as they always did.
func retrySave(
	ctx context.Context,
	log *slog.Logger,
	room string,
	save func(context.Context) error,
) error {
	return retry.Do(ctx, log, "session save "+room, saveAttempts, retryBase, attemptTimeout, save)
}
