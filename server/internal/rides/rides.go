// Package rides is the solo half of ride persistence (#110): a room session
// is saved by the hub's saver when it closes; a solo ride posts itself here
// when it ends. Same row builder, same XP streak term, room_id NULL — one
// history feeding streaks, curves and the FTP suggestion either way.
package rides

import (
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/keyset"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Bounds mirror the WS metrics gate and fitexport: attacker-controlled
// series, capped before any of it is believed.
const (
	maxSamples   = 6 * 60 * 60 // 6 h at 1 Hz — longer than any indoor session
	minSamples   = 60          // under a minute is a misclick, the saver's rule
	maxBodyBytes = 4 << 20
	maxWatts     = 3000
	// The rider's trim, as workout/guards bounds it and protocol.BiasOr clamps it.
	minBias    = 0.8
	maxBias    = 1.2
	maxCadence = 250
	maxHR      = 250
)

type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// RideUploader mirrors stats.RideUploader — a saved solo ride goes to the
// same external worker; nil means the feature is absent.
type RideUploader interface {
	RideSaved(rideID pgtype.UUID)
}

type Service struct {
	store    *store.Store
	users    UserSource
	log      *slog.Logger
	uploader RideUploader
	keeper   stats.RideKeeper
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) SetUploader(u RideUploader) { s.uploader = u }

// SetRideKeeper wires the trophy case in (#467): a solo ride earns its
// achievements the same way a room session's does.
func (s *Service) SetRideKeeper(k stats.RideKeeper) { s.keeper = k }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/rides", s.handleList)
	mux.HandleFunc("GET /api/rides/best", s.handleBest)
	mux.HandleFunc("POST /api/rides", s.handleCreate)
	mux.HandleFunc("GET /api/rides/{id}", s.handleGet)
	mux.HandleFunc("GET /api/rides/{id}/export", s.handleExport)
	// A picture of the ride, for the rider to put wherever pictures go (#2112).
	mux.HandleFunc("GET /api/rides/{id}/card.png", s.handleCard)
	mux.HandleFunc("POST /api/rides/{id}/export/retry", s.handleRetryExport)
	mux.HandleFunc("PATCH /api/rides/{id}", s.handleShare)
	mux.HandleFunc("PUT /api/rides/{id}/ftp-after", s.handleFtpAfter)
	mux.HandleFunc("DELETE /api/rides/{id}", s.handleDelete)
}

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

type rideJSON struct {
	ID          string  `json:"id"`
	WorkoutName string  `json:"workoutName"`
	StartedAt   string  `json:"startedAt"`
	Seconds     int     `json:"seconds"`
	AvgWatts    int     `json:"avgWatts"`
	Kj          int     `json:"kj"`
	Execution   float64 `json:"execution"`
	// #1143: false when the workout prescribed nothing to score, so a client
	// shows "not scored" rather than a percentage that means nothing.
	ExecutionScored bool `json:"executionScored"`
	Ftp             int  `json:"ftp"`
	Xp              int  `json:"xp"`
	// True for rides ridden in a room — the list marks them.
	Room bool `json:"room,omitempty"`
	// The per-ride opt-in (WATTROOM.md privacy, ADR-0024): friends see this
	// ride on the rider's page. Off by default, flipped by PATCH.
	SharedWithFriends bool `json:"sharedWithFriends"`
	// The Strava delivery's state — pending | delivered | failed — when the
	// ride has one (#1553), so the list can mark a failed upload; empty for a
	// ride that was never sent. The detail carries the whole record.
	ExportState string `json:"exportState,omitempty"`
}

// listPage is one page of the rides list (#1549): the list used to be one
// read capped at 200, and a rider's older rides fell off the end of the app.
const listPage = 100

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	params := db.ListUserRidesParams{UserID: user.ID, Limit: listPage, Destination: exportDestination}
	// The cursor is the previous page's last row, handed back verbatim: a
	// time and the ride id that breaks its tie. Both or neither — half a
	// cursor would page from a time with no tie-break, which is #2064.
	cursor, ok := keyset.FromQuery(w, r, "ride")
	if !ok {
		return
	}
	cursor.Apply(&params.Before, &params.BeforeID)
	rows, err := s.store.Queries.ListUserRides(r.Context(), params)
	if err != nil {
		httpx.Fail(w, s.log, "list rides failed", err, "Your rides could not be loaded.")
		return
	}
	out := make([]rideJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, rideJSONOf(row))
	}
	body := map[string]any{"rides": out, "more": len(rows) == listPage}
	// A full page means there may be more, and the cursor comes from the
	// server rather than from the rider's own `startedAt`: that field is
	// RFC 3339 to the second where started_at is microseconds, and a cursor
	// rounded down by a fraction of a second stepped over every ride inside
	// it (#2064) — including ones this page had not handed over. keyset.Next
	// is what keeps the precision.
	if len(rows) == listPage {
		last := rows[len(rows)-1]
		keyset.Next(body, last.StartedAt, last.ID)
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

func rideJSONOf(row db.ListUserRidesRow) rideJSON {
	out := rideJSON{
		ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
		StartedAt: row.StartedAt.Time.Format(time.RFC3339),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(row.FtpWatts), Xp: int(row.Xp),
		Room: row.RoomID.Valid, SharedWithFriends: row.SharedAt.Valid,
	}
	if row.ExportState != nil {
		out.ExportState = *row.ExportState
	}
	return out
}

// handleBest answers the ride page's "against your best" (#1687): the
// hardest ride of the same workout over the whole history. The page used
// to scan the first page of the list and call a year-old workout a first.
func (s *Service) handleBest(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	workout := r.URL.Query().Get("workout")
	if workout == "" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "workout names the workout to compare against.")
		return
	}
	var except pgtype.UUID
	if raw := r.URL.Query().Get("except"); raw != "" {
		id, err := store.ParseUUID(raw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "except must be a ride id.")
			return
		}
		except = id
	}
	row, err := s.store.Queries.BestUserRideOfWorkout(r.Context(), db.BestUserRideOfWorkoutParams{
		UserID: user.ID, WorkoutName: workout, ID: except, Destination: exportDestination,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ride": nil})
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "best ride failed", err, "Your rides could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ride": rideJSONOf(db.ListUserRidesRow(row))})
}

// handleShare flips one ride's friends-visibility (ADR-0024). Owner-only:
// the update's where clause carries the user, so someone else's ride reads
// as absent rather than as forbidden.
func (s *Service) handleShare(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return
	}
	var body struct {
		SharedWithFriends *bool `json:"sharedWithFriends"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil || body.SharedWithFriends == nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Send sharedWithFriends as true or false.", "sharedWithFriends")
		return
	}
	n, err := s.store.Queries.SetRideShared(r.Context(), db.SetRideSharedParams{
		Shared: *body.SharedWithFriends, ID: id, UserID: user.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "ride share failed", err, "The ride could not be updated.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id": store.UUIDString(id), "sharedWithFriends": *body.SharedWithFriends,
	})
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
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
	if segments, err := workout.Parse(req.WorkoutJSON); err != nil || len(segments) == 0 {
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
			"A ride under a minute is not saved — same rule the room uses.", "samples")
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

	row, err := stats.BuildRideRow(user.ID, pgtype.UUID{}, req.WorkoutName,
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
	id, err := q.CreateRide(r.Context(), row)
	if err != nil {
		httpx.Fail(w, s.log, "solo ride save failed", err, "The ride could not be saved. It stays on this device.")
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
