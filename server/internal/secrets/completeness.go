package secrets

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

// How far ADR-0035's sealing has actually got on this deployment: the number
// of identity rows still holding a refresh token in the clear.
//
// It exists because the fact was unreachable rather than unknowable. #1038 —
// dropping `identities.refresh_token` — has one precondition an agent cannot
// check: the count below, run against the LIVE database. The issue sat parked
// for eleven releases waiting for a person with psql. Publishing the number
// turns that precondition into something the deployment reports about itself.
//
// It is not a one-off for that issue. Above zero is an operational finding on
// its own: either WATTROOM_TOKEN_KEY is unset, in which case every pg_dump the
// deploy timer takes before a rollout carries live Strava credentials in the
// clear — the single thing ADR-0035 exists to prevent — or the backfill has not
// finished and is being retried.
//
// A count, and only a count. No label, no token, no rider: the metrics
// endpoint stays aggregate by architecture (WATTROOM.md), and a number that
// went up is the whole finding.
//
// A plain Gauge set by a loop rather than a GaugeFunc counting per scrape, for
// two reasons, neither of them the query's cost — that is one sequential scan
// of a table bounded by third-party connections, sub-millisecond at any size
// this app will see:
//
//   - A GaugeFunc has to return a float64 whatever the database says, and the
//     value it would return on a failed query is 0. Zero is the reading that
//     says "safe to drop the column". A signal whose failure mode is its
//     all-clear is worse than no signal.
//   - It would put a database round trip inside the collector, where a slow
//     query stalls the scrape that is meant to report on the server's health.
var plaintextTokens = promauto.With(metrics.Registry).NewGauge(prometheus.GaugeOpts{
	Name: "wattroom_identities_plaintext_refresh_tokens",
	Help: "Identity rows still holding a non-empty plaintext refresh_token (ADR-0035). 0 means sealing is complete; NaN means it has not been counted yet.",
})

func init() {
	// Not counted is not zero. A fresh Gauge reads 0, and 0 here is the
	// reading #1038 acts on — so until a count succeeds this publishes NaN,
	// which no `> 0` alert fires on and no operator mistakes for an all-clear.
	plaintextTokens.Set(math.NaN())
}

// observeJob is the jobmetrics name, so the count carries its own freshness:
// the gauge keeps its last good value when a count fails, and
// wattroom_job_last_success_timestamp_seconds{job="token seal completeness"}
// is what says whether that value is still worth believing. Reading 0 without
// reading the timestamp beside it is reading a stale snapshot.
const observeJob = "token seal completeness"

// ObserveEvery is how often the count is refreshed.
//
// The number moves at exactly two moments: the boot backfill sealing rows, and
// a new identity written while no key is configured. Neither wants an answer
// in seconds, and this repo redeploys several times a day, so the boot count
// below is the one that usually reports. Fifteen minutes is ~96 counts a day.
const ObserveEvery = 15 * time.Minute

// Observe counts the unsealed rows and publishes the result.
//
// Takes the queries rather than a *store.Store so a test can hand it one bound
// to a transaction: this count is global to the table, and `go test ./...` runs
// packages in parallel against one database.
func Observe(ctx context.Context, q *db.Queries) (int64, error) {
	n, err := q.CountPlaintextRefreshTokens(ctx)
	jobmetrics.Ran(observeJob, err)
	if err != nil {
		// The gauge keeps its last value on purpose. A transient failure that
		// reset it would either invent a 0 or erase a real finding; the
		// last-success timestamp is what marks the value stale.
		return 0, err
	}
	plaintextTokens.Set(float64(n))
	return n, nil
}

// Watch publishes the count now and every ObserveEvery until ctx is done, and
// returns immediately.
//
// It also says the number in the log, so an operator without Prometheus — a
// self-hoster following deploy/README.md — gets the same answer. Only when it
// changes: the first count of every boot is a change from "never counted", and
// a line every quarter of an hour would be noise nobody reads, which is the
// state this signal was invented to leave.
func Watch(ctx context.Context, q *db.Queries, log *slog.Logger) {
	if q == nil {
		return
	}
	said := int64(-1)
	safego.Supervise(log, time.Now, "token seal completeness", ctx.Done(), func() {
		ticker := time.NewTicker(ObserveEvery)
		defer ticker.Stop()
		for {
			switch n, err := Observe(ctx, q); {
			case err != nil:
				log.Error("counting unsealed refresh tokens", "err", err)
			case n == said:
			case n == 0:
				said = n
				log.Info("stored refresh tokens are all sealed", "plaintext", 0)
			default:
				said = n
				log.Warn("stored refresh tokens are in the clear — "+KeyEnv+" is unset, or the backfill has not finished (ADR-0035)",
					"plaintext", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}
