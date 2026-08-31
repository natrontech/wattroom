// Package progression is the read side of the training-analysis layer (#222):
// one endpoint serving cross-ride trends from ride summary columns. Formulas
// stay in internal/stats; the sample blobs are never read here.
package progression

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type UserSource interface {
	User(r *http.Request) (db.User, bool)
}

type Service struct {
	store *store.Store
	users UserSource
	log   *slog.Logger
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/progression", s.handleGet)
}

type curveJSON struct {
	D30 stats.Curve `json:"d30"`
	D90 stats.Curve `json:"d90"`
	All stats.Curve `json:"all"`
}

type rideTrendJSON struct {
	Date      string  `json:"date"`
	Seconds   int     `json:"seconds"`
	Kj        int     `json:"kj"`
	Execution float64 `json:"execution"`
	Ftp       int     `json:"ftp"`
	Best20m   int     `json:"best20m,omitempty"`
}

type loadJSON struct {
	// Building = inside SPEC's 28-day cold start: values ship, but the UI
	// shows no form status yet — a 42-day average over a week of data
	// misreads as a dangerous ramp.
	Building bool              `json:"building"`
	Fitness  float64           `json:"fitness"`
	Fatigue  float64           `json:"fatigue"`
	FormPct  float64           `json:"formPct"`
	Zone     string            `json:"zone"`
	Series   []stats.FormPoint `json:"series"`
}

type response struct {
	Curve curveJSON       `json:"curve"`
	Rides []rideTrendJSON `json:"rides"`
	// Current standing per SPEC: Category from the 90-day best 20-min w/kg.
	Category string    `json:"category"`
	WKg      float64   `json:"wkg"`
	Load     *loadJSON `json:"load,omitempty"` // absent with no ride history
}

// coldStartDays and seriesDays: docs/SPEC.md (Training load) and the /history
// chart window — roughly two Fitness time constants of context.
const (
	coldStartDays = 28
	seriesDays    = 120
)

func buildLoad(rows []db.ListUserProgressionRow, now time.Time) *loadJSON {
	if len(rows) == 0 {
		return nil
	}
	daily := make(map[string]float64, len(rows))
	for _, row := range rows {
		day := row.StartedAt.Time.UTC().Format(time.DateOnly)
		daily[day] += stats.Load(int(row.NormWatts), int(row.FtpWatts), int(row.Seconds))
	}
	series := stats.FitnessSeries(daily, rows[0].StartedAt.Time, now)
	if len(series) == 0 {
		return nil
	}
	last := series[len(series)-1]
	if len(series) > seriesDays {
		series = series[len(series)-seriesDays:]
	}
	formPct := 0.0
	if last.Fitness > 0 {
		formPct = last.Form / last.Fitness * 100
	}
	return &loadJSON{
		Building: now.Sub(rows[0].StartedAt.Time) < coldStartDays*24*time.Hour,
		Fitness:  last.Fitness,
		Fatigue:  last.Fatigue,
		FormPct:  formPct,
		Zone:     stats.FormZone(formPct),
		Series:   series,
	}
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "Not signed in.")
		return
	}
	bests, err := s.store.Queries.CurveBests(r.Context(), user.ID)
	if err != nil {
		s.log.Error("progression curve bests failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your progression could not be loaded.")
		return
	}
	rows, err := s.store.Queries.ListUserProgression(r.Context(), user.ID)
	if err != nil {
		s.log.Error("progression rides failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your progression could not be loaded.")
		return
	}

	out := response{
		Curve: curveJSON{
			D30: stats.Curve{Best5s: int(bests.D30Best5s), Best1m: int(bests.D30Best1m), Best5m: int(bests.D30Best5m), Best20m: int(bests.D30Best20m)},
			D90: stats.Curve{Best5s: int(bests.D90Best5s), Best1m: int(bests.D90Best1m), Best5m: int(bests.D90Best5m), Best20m: int(bests.D90Best20m)},
			All: stats.Curve{Best5s: int(bests.AllBest5s), Best1m: int(bests.AllBest1m), Best5m: int(bests.AllBest5m), Best20m: int(bests.AllBest20m)},
		},
		Rides:    make([]rideTrendJSON, 0, len(rows)),
		Category: stats.Category(int(bests.D90Best20m), float64(user.WeightKg)),
		Load:     buildLoad(rows, time.Now()),
	}
	if user.WeightKg > 0 {
		out.WKg = float64(bests.D90Best20m) / float64(user.WeightKg)
	}
	for _, row := range rows {
		out.Rides = append(out.Rides, rideTrendJSON{
			Date:      row.StartedAt.Time.Format(time.RFC3339),
			Seconds:   int(row.Seconds),
			Kj:        int(row.Kj),
			Execution: float64(row.Execution),
			Ftp:       int(row.FtpWatts),
			Best20m:   int(row.Best20m),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
