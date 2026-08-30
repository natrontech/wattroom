// Package rides is the solo half of ride persistence (#110): a room session
// is saved by the hub's saver when it closes; a solo ride posts itself here
// when it ends. Same row builder, same XP streak term, room_id NULL — one
// history feeding streaks, curves and the FTP suggestion either way.
package rides

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
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
	maxCadence   = 250
	maxHR        = 250
)

type UserSource interface {
	User(r *http.Request) (db.User, bool)
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
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) SetUploader(u RideUploader) { s.uploader = u }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/rides", s.handleList)
	mux.HandleFunc("POST /api/rides", s.handleCreate)
}

type sampleJSON struct {
	Watts   int `json:"watts"`
	HR      int `json:"hr,omitempty"`
	Cadence int `json:"cadence,omitempty"`
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
	Ftp         int     `json:"ftp"`
	Xp          int     `json:"xp"`
	// True for rides ridden in a room — the list marks them.
	Room bool `json:"room,omitempty"`
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	rows, err := s.store.Queries.ListUserRides(r.Context(), db.ListUserRidesParams{
		UserID: user.ID, Limit: 200,
	})
	if err != nil {
		s.log.Error("list rides failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your rides could not be loaded.")
		return
	}
	out := make([]rideJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, rideJSON{
			ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
			StartedAt: row.StartedAt.Time.Format(time.RFC3339),
			Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
			Execution: float64(row.Execution), Ftp: int(row.FtpWatts), Xp: int(row.Xp),
			Room: row.RoomID.Valid,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rides": out})
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
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
	if req.WorkoutName == "" || len(req.WorkoutName) > 80 {
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
		samples[i] = protocol.RiderMetrics{
			Watts: sample.Watts, HR: sample.HR, Cadence: sample.Cadence, Seq: i,
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
	id, err := s.store.Queries.CreateRide(r.Context(), row)
	if err != nil {
		s.log.Error("solo ride save failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The ride could not be saved. It stays on this device.")
		return
	}
	if s.uploader != nil {
		s.uploader.RideSaved(id)
	}
	s.log.Info("solo ride saved", "seconds", row.Seconds, "kj", row.Kj)
	httpx.WriteJSON(w, http.StatusCreated, rideJSON{
		ID: store.UUIDString(id), WorkoutName: req.WorkoutName,
		StartedAt: req.StartedAt.Format(time.RFC3339),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
		Execution: float64(row.Execution), Ftp: int(user.FtpWatts), Xp: int(row.Xp),
	})
}
