// Package housekeeping runs the deletions that a write cannot trigger.
//
// Most of this codebase's cleanup is bounded by a COUNT and swept on write,
// which is exactly sufficient: only a write can push a chat log past 500
// messages, so only a write needs to check. A bound measured in TIME is the
// other kind. Nothing has to happen for a row to age out of it, so nothing
// will — and the quieter an instance is, the longer it keeps what it promised
// to drop (#1153, #1163).
//
// One loop rather than a ticker per package, because the two sweeps here are
// the same job at different tables and neither is worth its own goroutine,
// its own supervisor and its own interval to get wrong separately.
package housekeeping

import (
	"context"
	"log/slog"
	"time"

	"github.com/natrontech/wattroom/server/internal/jobmetrics"

	"github.com/natrontech/wattroom/server/internal/recap"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
)

// Every is how often the sweeps run. Daily is ample: the tightest bound they
// enforce is 30 days, and a row outliving its bound by hours is not the
// failure — outliving it forever is.
const Every = 24 * time.Hour

// sweep is one deletion, named for the log line it produces when it fails.
type sweep struct {
	name string
	run  func(context.Context, *store.Store) error
}

func sweeps() []sweep {
	return []sweep{{
		// Moved here from a sweep of its own in main (#736 added the caller,
		// #1163 gathered the daily sweeps; the two ran side by side until
		// audit 2026-09-09). They authenticate
		// nothing — GetSessionUser filters on expiry — but a row is a record
		// of when a rider signed in, and nothing promised to keep those.
		name: "expired sessions",
		run: func(ctx context.Context, st *store.Store) error {
			return batched(ctx, func(ctx context.Context) (int64, error) {
				return st.Queries.DeleteExpiredSessions(ctx)
			})
		},
	}, {
		// #1153: ADR-0034 keeps a recap 90 days so the table stops answering
		// "where was this person in March". It was swept only when a session
		// ended, which is the one thing a quiet room does not do.
		name: "session recaps",
		run: func(ctx context.Context, st *store.Store) error {
			return batched(ctx, func(ctx context.Context) (int64, error) {
				return st.Queries.PruneSessionRecaps(ctx, recap.RetentionDays)
			})
		},
	}, {
		// A chat image's 15-minute grace is a bound measured in time, and it
		// was swept only on a write (audit 2026-09-09): an upload abandoned
		// in a room that then went quiet was never swept.
		name: "orphan chat images",
		run: func(ctx context.Context, st *store.Store) error {
			return batched(ctx, st.Queries.PruneOrphanChatImages)
		},
	}}
}

// batch is what one delete statement takes at most; the queries carry the
// same number in their LIMIT.
const batch = 10000

// batched runs a bounded delete until a batch comes back short, so the first
// sweep after a long gap is many small transactions rather than one that
// holds the table (audit 2026-09-09).
func batched(ctx context.Context, del func(context.Context) (int64, error)) error {
	for {
		n, err := del(ctx)
		if err != nil || n < batch {
			return err
		}
	}
}

// Run sweeps at boot and then every Every, until ctx is done.
//
// At boot as well as on the tick, because a daily ticker on a server that is
// redeployed more often than daily never fires at all — and this repo releases
// several times a day. Both sweeps are indexed deletes of rows nothing reads,
// so paying them at every start costs nothing worth measuring.
func Run(ctx context.Context, st *store.Store, log *slog.Logger) {
	safego.Supervise(log, time.Now, "housekeeping", ctx.Done(), func() {
		ticker := time.NewTicker(Every)
		defer ticker.Stop()
		for {
			Once(ctx, st, log)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

// Once runs every sweep, and is what the tests drive. One failing sweep must
// not stop the others: they share a schedule and nothing else.
func Once(ctx context.Context, st *store.Store, log *slog.Logger) {
	for _, s := range sweeps() {
		// A budget per sweep (audit 2026-09-09): a sweep that hangs on an
		// undeadlined context took its ticker with it, silently.
		sweepCtx, cancel := context.WithTimeout(ctx, sweepBudget)
		err := s.run(sweepCtx, st)
		cancel()
		jobmetrics.Ran("housekeeping "+s.name, err)
		if err != nil {
			log.Warn("housekeeping sweep failed", "sweep", s.name, "err", err)
		}
	}
}

const sweepBudget = 5 * time.Minute
