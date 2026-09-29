package rides

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/wallet"
	"github.com/natrontech/wattroom/server/internal/wardrobe"
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
	// On a road (#3052): metres along it and the height there; absent off one.
	M   float64 `json:"m,omitempty"`
	Alt float64 `json:"alt,omitempty"`
}

type createRequest struct {
	WorkoutName string       `json:"workoutName"`
	WorkoutJSON string       `json:"workoutJson"`
	StartedAt   time.Time    `json:"startedAt"`
	Samples     []sampleJSON `json:"samples"`
	// The stored route the ride rode (#3053): one of the rider's own.
	RouteID string `json:"routeId,omitempty"`
	// How the trainer was driven along it (#3516): stats.DriveSIM, DriveGears
	// or DriveERGByRoad. Unsaid, the ride's time is not known.
	Drive string `json:"drive,omitempty"`
}

// roadRefusal answers a sample off the road in the bounds protocol holds it to.
var roadRefusal = fmt.Sprintf(
	"A sample's place on the road is out of range — it only moves forward, at most %d m a second, between %d m and %d m high.",
	protocol.MaxRoadSpeedMps, protocol.MinRoadAltM, protocol.MaxRoadAltM)

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
	if len(req.Samples) < protocol.MinRideSamples {
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
		// The bounds are the trim's own, the ones protocol.BiasOr clamps to;
		// 0 is a sample from a ride that sends none.
		if sample.Bias != 0 && (sample.Bias < protocol.MinBias || sample.Bias > protocol.MaxBias) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				fmt.Sprintf("A sample's bias is out of range — %.1f to %.1f.", protocol.MinBias, protocol.MaxBias), "samples")
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
			M: sample.M, Alt: sample.Alt,
		}
		// A sample a second: along the road, never back, and no faster than
		// a rider can go (#3052).
		if !samples[i].RoadInBounds() || i > 0 && !protocol.RoadFollows(samples[i-1], samples[i], 1) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", roadRefusal, "samples")
			return
		}
	}

	if !stats.KnownDrive(req.Drive) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Say how the trainer was driven along the road: sim, gears or ergByRoad.", "drive")
		return
	}
	route, ridden, ok := s.routeOf(w, r, user.ID, req.RouteID)
	if !ok {
		return
	}
	row, err := stats.BuildRideRow(user.ID, req.WorkoutName,
		req.WorkoutJSON, req.StartedAt, int(user.FtpWatts), samples)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That ride could not be scored against this workout.", "workoutJson")
		return
	}
	stats.SetHow(&row, stats.RideMode(req.WorkoutJSON, false), req.WorkoutJSON, route != nil, req.Drive, stats.WeightThatDay(user))
	if route != nil {
		ride := stats.ReplayRoad(ridden, samples, float64(user.WeightKg)+protocol.BikeKg)
		stats.SetRoad(&row, *route, ride)
		// The replay is the record (ADR-0074); a client whose own metres
		// part from it by more than this is worth knowing about.
		if ride.Gap > stats.ReplayGapLogged {
			s.log.Warn("road ride replay parts from the client", "route", req.RouteID,
				"replayed_m", ride.DistanceM, "gap", ride.Gap)
		}
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
	watts := make([]int, len(samples))
	for i, sample := range samples {
		watts[i] = sample.Watts
	}
	// Batzen in the ride's own transaction, under the lock taken above (#3152):
	// the day's cap holds under two saves at once.
	if err := wallet.MintRide(r.Context(), q, user.ID, id, wallet.Batzen(watts, int(row.FtpWatts), false)); err != nil {
		httpx.Fail(w, s.log, "solo ride wallet mint failed", err, "The ride could not be saved. It stays on this device.")
		return
	}
	// What the rider wore on it is theirs to keep now, past the undo (#3154).
	if err := wardrobe.MarkWorn(r.Context(), q, user.ID); err != nil {
		httpx.Fail(w, s.log, "solo ride outfit worn failed", err, "The ride could not be saved. It stays on this device.")
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
		s.keeper.RideSaved(user.ID, stats.Facts(req.StartedAt, int(user.FtpWatts), watts))
	}
	s.log.Info("solo ride saved", "seconds", row.Seconds, "kj", row.Kj)
	httpx.WriteJSON(w, http.StatusCreated, rideJSON{
		ID: store.UUIDString(id), WorkoutName: req.WorkoutName,
		StartedAt: req.StartedAt.Format(time.RFC3339),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(user.FtpWatts), Xp: int(row.Xp),
		DistanceM: row.DistanceM, ClimbedM: row.ClimbedM,
	})
}

// routeOf reads the stored route a ride names (#3053): the rider's own, or
// none when the ride names none. A route that is someone else's reads as
// absent, like a ride that is.
func (s *Service) routeOf(w http.ResponseWriter, r *http.Request, user pgtype.UUID, id string) (*db.GetOwnerRouteRow, road.Road, bool) {
	if id == "" {
		return nil, road.Road{}, true
	}
	routeID, err := store.ParseUUID(id)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a route id.", "routeId")
		return nil, road.Road{}, false
	}
	route, err := s.store.Queries.GetOwnerRoute(r.Context(), db.GetOwnerRouteParams{ID: routeID, OwnerID: user})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found",
			"That route is not one of yours, so the ride cannot be saved on it.", "routeId")
		return nil, road.Road{}, false
	}
	if err != nil {
		httpx.Fail(w, s.log, "ride route read failed", err, "The ride could not be saved. It stays on this device.")
		return nil, road.Road{}, false
	}
	ridden, err := road.UnpackRoad(route.Road)
	if err != nil {
		httpx.Fail(w, s.log, "stored road unreadable", err, "The ride could not be saved. It stays on this device.", "route", id)
		return nil, road.Road{}, false
	}
	return &route, ridden, true
}
