// Package usage publishes how much WattRoom is used (#2913): accounts,
// signups, riders who ride, rides. Until this, /metrics said whether anyone
// was riding right now and nothing about whether the app was growing — that
// took psql against the live database.
//
// Recounted from Postgres on a loop rather than counted as events, so the
// numbers start at the first row ever written, not at the last deploy, and a
// restart does not reset them.
//
// Counts only (WATTROOM.md — privacy is architecture): no label names a crew,
// a channel or a rider, and `window` is one of three constants. This is the
// operator's own telemetry on a private port, not product analytics — nothing
// per rider, no events, nothing that leaves the operator's Prometheus.
package usage

import (
	"context"
	"log/slog"
	"math"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/natrontech/wattroom/server/internal/jobmetrics"
	"github.com/natrontech/wattroom/server/internal/metrics"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func gauge(name, help string) prometheus.Gauge {
	g := promauto.With(metrics.Registry).NewGauge(prometheus.GaugeOpts{Name: name, Help: help})
	// Not counted is not zero: a fresh Gauge reads 0, and a scrape that lands
	// before the boot count would draw every account vanishing and coming
	// back. NaN draws a gap. The vecs below need nothing — they emit no sample
	// until one is set.
	g.Set(math.NaN())
	return g
}

var (
	accounts          = gauge("wattroom_accounts", "Accounts that exist.")
	rides             = gauge("wattroom_rides", "Rides recorded, all time.")
	riddenSeconds     = gauge("wattroom_ridden_seconds", "Time ridden across every recorded ride.")
	riddenJoules      = gauge("wattroom_ridden_joules", "Work done across every recorded ride.")
	crews             = gauge("wattroom_crews", "Crews that exist.")
	workouts          = gauge("wattroom_workouts", "Workouts riders have built or imported (the built-in library not counted).")
	tracks            = gauge("wattroom_tracks", "Tracks in the jukebox library.")
	stravaConnections = gauge("wattroom_strava_connections", "Accounts connected to Strava.")
	sessionsUpcoming  = gauge("wattroom_sessions_upcoming", "Scheduled sessions that have not started yet.")

	signups = promauto.With(metrics.Registry).NewGaugeVec(prometheus.GaugeOpts{
		Name: "wattroom_accounts_created",
		Help: "Accounts created within the window (1d | 7d | 30d) that still exist.",
	}, []string{"window"})
	activeRiders = promauto.With(metrics.Registry).NewGaugeVec(prometheus.GaugeOpts{
		Name: "wattroom_riders_active",
		Help: "Accounts with a recorded ride that started within the window (1d | 7d | 30d).",
	}, []string{"window"})
)

// observeJob is the jobmetrics name: a count that stopped refreshing shows up
// in wattroom_job_last_success_timestamp_seconds like every other loop, and
// the gauges keep their last good values meanwhile.
const observeJob = "usage counts"

// ObserveEvery is how often the counts are refreshed. Usage moves in hours,
// and the dashboard reading it plots days.
const ObserveEvery = 5 * time.Minute

// Observe counts and publishes. Takes the queries rather than a *store.Store
// so a test can hand it one bound to a transaction.
func Observe(ctx context.Context, q *db.Queries) (db.CountUsageRow, error) {
	n, err := q.CountUsage(ctx)
	jobmetrics.Ran(observeJob, err)
	if err != nil {
		return n, err
	}
	accounts.Set(float64(n.Accounts))
	rides.Set(float64(n.Rides))
	riddenSeconds.Set(float64(n.RiddenSeconds))
	riddenJoules.Set(float64(n.RiddenKj) * 1000)
	crews.Set(float64(n.Crews))
	workouts.Set(float64(n.Workouts))
	tracks.Set(float64(n.Tracks))
	stravaConnections.Set(float64(n.StravaConnections))
	sessionsUpcoming.Set(float64(n.SessionsUpcoming))
	for window, v := range map[string][2]int64{
		"1d":  {n.Accounts1d, n.Riders1d},
		"7d":  {n.Accounts7d, n.Riders7d},
		"30d": {n.Accounts30d, n.Riders30d},
	} {
		signups.WithLabelValues(window).Set(float64(v[0]))
		activeRiders.WithLabelValues(window).Set(float64(v[1]))
	}
	return n, nil
}

// Watch publishes the counts now and every ObserveEvery until ctx is done, and
// returns immediately.
func Watch(ctx context.Context, q *db.Queries, log *slog.Logger) {
	if q == nil {
		return
	}
	safego.Supervise(log, time.Now, observeJob, ctx.Done(), func() {
		ticker := time.NewTicker(ObserveEvery)
		defer ticker.Stop()
		for {
			if _, err := Observe(ctx, q); err != nil {
				log.Error("counting usage", "err", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}
