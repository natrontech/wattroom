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

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Ledger sources — the xp_events check constraint's vocabulary.
const (
	sourceLounge      = "lounge"
	sourceSession     = "session"
	sourceAchievement = "achievement"
	sourceSprintWin   = "sprint_win"
	sourceDjTrack     = "dj_track"
	sourceCoached     = "coached"
)

type UserSource interface {
	User(r *http.Request) (db.User, bool)
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
	go s.work()
	return s
}

// work drains the queue; exits when the process does — like the hub's chat
// saver, the service lives as long as the server.
// ponytail: one worker; every job is a handful of single-row statements.
func (s *Service) work() {
	for job := range s.jobs {
		job(context.Background())
	}
}

// enqueue never blocks the caller: a full queue drops the event and says so.
// XP lost to a backlog is a shrug; a stalled tick is not.
func (s *Service) enqueue(what string, job func(context.Context)) {
	select {
	case s.jobs <- job:
	default:
		s.log.Warn("gamify queue full, event dropped", "event", what)
	}
}
