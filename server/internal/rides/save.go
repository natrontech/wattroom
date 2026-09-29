package rides

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// POST /api/rides: a solo, free or recovered ride the browser uploads, bounded
// before any of it is believed.

type sampleJSON struct {
	Watts   int `json:"watts"`
	HR      int `json:"hr,omitempty"`
	Cadence int `json:"cadence,omitempty"`
	// The trim this second was ridden at (#1530). The room's samples have
	// carried it since #795 and a solo ride's did not, so the same ride
	// scored one number on the summary and another on its own page: the live
	// meter bands the BIASED target and this side re-scored the workout as
	// written. Absent (0) is a ride with no trim — protocol.BiasOr's default.
	Bias float64 `json:"bias,omitempty"`
	// The workout second this sample was ridden at (#1733); the score keys on
	// it, so a pause mid-block no longer shifts every later second onto the
	// wrong block. Absent (0 throughout) scores by index, as before.
	Clock int `json:"clock,omitempty"`
	// The rider's guard had the trainer off the target (#1796); not scored.
	Released bool `json:"released,omitempty"`
}

type createRequest struct {
	WorkoutName string       `json:"workoutName"`
	WorkoutJSON string       `json:"workoutJson"`
	StartedAt   time.Time    `json:"startedAt"`
	Samples     []sampleJSON `json:"samples"`
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	if !s.saves.Spend(user.ID) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"Too many rides saved in one minute — give it a moment and try again.")
		return
	}
	// A ride body outgrows DecodeStrict's 64 KB — an hour is ~100 KB of JSON.
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req createRequest
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}

	req.WorkoutName = strings.TrimSpace(req.WorkoutName)
	if req.WorkoutName == "" || utf8.RuneCountInString(req.WorkoutName) > 80 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A workout name has to be 1-80 characters.", "workoutName")
		return
	}
	// An empty workout is a free ride's (ADR-0059), and only when it says
	// so: unmarked, it is a client that lost its steps.
	if segments, err := workout.Parse(req.WorkoutJSON); err != nil ||
		(len(segments) == 0 && !workout.Unscored(req.WorkoutJSON)) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a workout the engine can ride.", "workoutJson")
		return
	}
	if req.StartedAt.IsZero() || req.StartedAt.After(time.Now().Add(time.Minute)) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A ride starts at a real time in the past.", "startedAt")
		return
	}
	if len(req.Samples) < minSamples {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A ride under a minute is not saved — the same rule a session uses.", "samples")
		return
	}
	if len(req.Samples) > maxSamples {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A ride longer than six hours is not something this saves.", "samples")
		return
	}
	samples := make([]protocol.RiderMetrics, len(req.Samples))
	for i, sample := range req.Samples {
		if sample.Watts < 0 || sample.Watts > maxWatts ||
			sample.Cadence < 0 || sample.Cadence > maxCadence ||
			sample.HR < 0 || sample.HR > maxHR {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A sample is out of range — watts 0-3000, cadence 0-250, heart rate 0-250.", "samples")
			return
		}
		// The bounds are the trim's own (workout/guards DEFAULTS.biasMin/Max,
		// and what protocol.BiasOr clamps to) rather than numbers invented
		// here; 0 is a sample from a ride that sends none.
		if sample.Bias != 0 && (sample.Bias < minBias || sample.Bias > maxBias) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A sample's bias is out of range — 0.8 to 1.2.", "samples")
			return
		}
		// A workout second past the six-hour ceiling is no second of any
		// workout this saves — the same bound the sample count has.
		if sample.Clock < 0 || sample.Clock > maxSamples {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A sample's workout second is out of range.", "samples")
			return
		}
		samples[i] = protocol.RiderMetrics{
			Watts: sample.Watts, HR: sample.HR, Cadence: sample.Cadence, Bias: sample.Bias, Clock: sample.Clock, Released: sample.Released, Seq: i,
		}
	}

	row, err := stats.BuildRideRow(user.ID, req.WorkoutName,
		req.WorkoutJSON, req.StartedAt, int(user.FtpWatts), samples)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That ride could not be scored against this workout.", "workoutJson")
		return
	}
	row.Xp += stats.StreakXP(r.Context(), s.store.Queries, user.ID, req.StartedAt)
	// Under the rider's row lock, and only if it is not there yet (audit
	// 2026-09-09): the recovery card retries a POST whose answer was lost, and
	// the ride has no key of its own.
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "solo ride save begin failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(r.Context(), user.ID); err != nil {
		httpx.Fail(w, s.log, "solo ride save lock failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	if existing, err := q.FindRideAt(r.Context(), db.FindRideAtParams{UserID: user.ID, StartedAt: row.StartedAt}); err == nil {
		// Already saved: the same answer as the first time, no second row.
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": store.UUIDString(existing)})
		return
	}
	// A different start that shares a second with a saved ride is not a
	// retry and not a second ride either (#3044): nobody rides two at once.
	overlaps, err := q.RideOverlaps(r.Context(), db.RideOverlapsParams{
		UserID: user.ID, StartsAt: row.StartedAt,
		EndsAt: pgtype.Timestamptz{Time: row.StartedAt.Time.Add(time.Duration(row.Seconds) * time.Second), Valid: true},
	})
	if err != nil {
		httpx.Fail(w, s.log, "solo ride overlap check failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	if overlaps {
		httpx.WriteError(w, http.StatusConflict, "conflict",
			"You already have a ride saved at this time, and nobody rides two at once — this one was not saved.")
		return
	}
	// The day's ceiling, under the same lock (#3044). The ride keeps every
	// other number; only what it pays is cut, and the row says what it paid.
	minted, err := q.UploadXpToday(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "solo ride xp ceiling read failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	row.Xp = min(row.Xp, max(0, maxUploadXpPerDay-minted))
	id, err := q.CreateRide(r.Context(), row)
	if err != nil {
		httpx.Fail(w, s.log, "solo ride save failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	if err := q.AddUploadXp(r.Context(), db.AddUploadXpParams{UserID: user.ID, Xp: row.Xp}); err != nil {
		httpx.Fail(w, s.log, "solo ride xp ceiling write failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Fail(w, s.log, "solo ride save commit failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	if s.uploader != nil {
		s.uploader.RideSaved(id)
	}
	if s.keeper != nil {
		watts := make([]int, len(samples))
		for i, sample := range samples {
			watts[i] = sample.Watts
		}
		s.keeper.RideSaved(user.ID, stats.Facts(req.StartedAt, int(user.FtpWatts), watts))
	}
	s.log.Info("solo ride saved", "seconds", row.Seconds, "kj", row.Kj)
	httpx.WriteJSON(w, http.StatusCreated, rideJSON{
		ID: store.UUIDString(id), WorkoutName: req.WorkoutName,
		StartedAt: req.StartedAt.Format(time.RFC3339),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(user.FtpWatts), Xp: int(row.Xp),
	})
}
