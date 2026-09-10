// Package gamify is the trophy case (#467): XP earned off the bike, the
// achievement catalogue, and the read side that shows them. It hears about
// the world through keeper hooks — the hub's XpKeeper, the saver's and the
// solo endpoint's RideKeeper, the voice ticker — and never touches live
// room state itself. Every number is docs/SPEC.md's.
package gamify

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Ledger sources — the xp_events check constraint's vocabulary.
const (
	sourceLounge      = "lounge"
	sourceSession     = "session"
	sourceAchievement = "achievement"
	sourceSprintWin   = "sprint_win"
	sourceGameWin     = "game_win"
	sourceDjTrack     = "dj_track"
	sourceCoached     = "coached"
)

type UserSource interface {
	User(r *http.Request) (db.User, bool)
	RequireUser(w http.ResponseWriter, r *http.Request, refusal string) (db.User, bool)
}

type Service struct {
	store *store.Store
	users UserSource
	log   *slog.Logger
	now   func() time.Time
	// Every keeper hook enqueues here and returns; one worker does the
	// database work, so a slow Postgres backs up this queue and never a
	// room tick, a webhook, or a rider's save.
	jobs chan func(context.Context)
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	s := &Service{
		store: st, users: users, log: log, now: time.Now,
		jobs: make(chan func(context.Context), 256),
	}
	// Supervised (#651): a poison job is logged and skipped, the queue lives on.
	safego.Supervise(log, s.now, "gamify worker", nil, s.work)
	return s
}

// work drains the queue; exits when the process does — like the hub's chat
// saver, the service lives as long as the server.
// ponytail: one worker; every job is a handful of single-row statements.
func (s *Service) work() {
	for job := range s.jobs {
		// A deadline per job (audit 2026-09-09): one hung statement on an
		// undeadlined context wedged the only worker for good, the queue
		// filled, and every XP event after it was dropped with a warning
		// nobody alerts on.
		ctx, cancel := context.WithTimeout(context.Background(), jobBudget)
		job(ctx)
		cancel()
	}
}

// jobBudget bounds one queued job: a handful of single-row statements.
const jobBudget = 5 * time.Second

// enqueue never blocks the caller: a full queue drops the event and says so.
// XP lost to a backlog is a shrug; a stalled tick is not.
func (s *Service) enqueue(what string, job func(context.Context)) {
	select {
	case s.jobs <- job:
	default:
		s.log.Warn("gamify queue full, event dropped", "event", what)
	}
}
