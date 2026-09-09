// Package retry is the one bounded retry the server's hand-offs use: a
// per-attempt timeout, a doubling backoff, and a cap on attempts, honouring
// the caller's context. Lifted from stats.retrySave (#235) when the recap
// keeper needed the same shape (audit 2026-09-09).
package retry

import (
	"context"
	"log/slog"
	"time"
)

// Do runs fn until it succeeds, attempts run out, or ctx is cancelled —
// returning the last attempt's error.
func Do(
	ctx context.Context,
	log *slog.Logger,
	what string,
	attempts int,
	base, perAttempt time.Duration,
	fn func(context.Context) error,
) error {
	wait := base
	for attempt := 1; ; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, perAttempt)
		err := fn(attemptCtx)
		cancel()
		if err == nil || attempt == attempts {
			return err
		}
		log.Warn(what+" failed, retrying", "err", err, "attempt", attempt, "wait", wait)
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return err
		}
		wait *= 2
	}
}
