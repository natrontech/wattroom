package notify

// The hour-before reminder (#841, ADR-0030). The other three session mails are
// sent by the handler that caused them; this one has no handler, so it needs
// something that wakes up and looks. A ticker and a claim query are all that
// takes: one instance (WATTROOM.md), so no leader election, and no scheduler
// dependency for what a `for` and a `select` already do.

import (
	"context"
	"github.com/natrontech/wattroom/server/internal/safego"
	"sync"
	"time"

	"github.com/natrontech/wattroom/server/internal/jobmetrics"

	"github.com/jackc/pgx/v5/pgtype"
)

// A minute is the granularity of "in an hour": against a one-hour window it
// puts every reminder between 59 and 60 minutes ahead.
//
// ponytail: no index on (reminded_at, starts_at) — scheduled_sessions is small
// and already indexed on (room_id, starts_at). Add one when a sequential scan
// every minute stops being free.
const remindTick = time.Minute

// noActor excludes nobody from the audience. The other three mails skip the
// rider who caused them, because they already know; a reminder is caused by
// the clock, so everyone opted in should hear it. Valid but zero, which is
// never a real id — a NULL here would make `u.id <> $2` NULL and quietly mail
// nobody at all.
var noActor = pgtype.UUID{Valid: true}

// RemindLoop mails the hour-before reminder until ctx is done. Started once
// from main, under safego.Supervise like the expired-session sweep.
//
// ponytail: main hands it a background context, so the exit condition is the
// process ending — same ceiling the session sweep already runs under. Worth
// threading a real shutdown context through both the day the server grows one.
func (s *Service) RemindLoop(ctx context.Context) {
	ticker := time.NewTicker(remindTick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.remindDue(ctx)
		}
	}
}

// remindDue claims everything starting within the hour and mails it.
//
// A claimed session whose mail then fails is not retried. The row is already
// marked, and the alternative — leaving it unclaimed until a send succeeds —
// is how one unreachable mail provider turns into a room full of duplicates.
func (s *Service) remindDue(ctx context.Context) {
	claimCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	due, err := s.store.Queries.ClaimSessionsToRemind(claimCtx)
	cancel()
	jobmetrics.Ran("session reminders", err)
	if err != nil {
		s.log.Error("claiming sessions to remind failed", "err", err)
		return
	}
	// A budget per session, not one minute shared across the batch (audit
	// 2026-09-09), and the sessions in flight together (#1641): a hundred
	// claimed sessions on a slow provider ran serially for longer than the
	// ticker, which coalesces, and anything starting meanwhile left the
	// hour window unreminded. The claim already marked every row, so the
	// batch is drained here whatever it costs — bounded by the pool.
	var wg sync.WaitGroup
	slots := make(chan struct{}, reminderWorkers)
	for _, session := range due {
		slots <- struct{}{}
		wg.Add(1)
		safego.Go(s.log, "session reminder", func() {
			defer wg.Done()
			defer func() { <-slots }()
			one, cancel := context.WithTimeout(ctx, reminderBudget)
			defer cancel()
			room, err := s.store.Queries.GetRoomByID(one, session.RoomID)
			if err != nil {
				s.log.Error("reminder room lookup failed", "err", err, "session", session.ID)
				return
			}
			s.log.Info("session reminder", "room", room.Slug, "workout", session.WorkoutName)
			s.sessionMail(one, room, session.WorkoutName, session.StartsAt.Time, noActor, sessionReminder)
		})
	}
	wg.Wait()
	if len(due) > 0 {
		s.log.Info("session reminders claimed", "sessions", len(due))
	}
}

// reminderBudget bounds one session's reminder mail — every target, at the
// mailer's own per-request timeout.
const reminderBudget = 2 * time.Minute

// reminderWorkers is how many sessions are mailed at once (#1641).
const reminderWorkers = 8
