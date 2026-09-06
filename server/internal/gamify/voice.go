package gamify

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Lounge XP (docs/SPEC.md XP sources, defaults — tune in alpha): one XP per
// five full minutes in voice, capped per rider per UTC day. Presence is what
// LiveKit reports — the server cannot hear who talks, so "talking" is
// measured as being on the call.
const (
	blockMinutes   = 5
	LoungeDailyCap = 24
	voicePoll      = time.Minute
)

// VoiceSource is who is in a voice channel right now — the hub, which
// locks, copies and unlocks on its side.
type VoiceSource interface {
	VoiceRiderIDs() []string
}

// loungeLedger is where a completed block lands: the Service's is the
// database; the tests' is a map.
type loungeLedger interface {
	LoungeBlock(ctx context.Context, riderID string, at time.Time)
}

// voiceClock counts each rider's consecutive minutes on a call and pays a
// block every five. Leaving resets the count: five FULL minutes, not five
// minutes in total.
type voiceClock struct {
	minutes map[string]int
	ledger  loungeLedger
}

func (c *voiceClock) tick(ctx context.Context, present []string, now time.Time) {
	here := make(map[string]struct{}, len(present))
	for _, id := range present {
		here[id] = struct{}{}
		c.minutes[id]++
		if c.minutes[id] >= blockMinutes {
			c.minutes[id] = 0
			c.ledger.LoungeBlock(ctx, id, now)
		}
	}
	for id := range c.minutes {
		if _, ok := here[id]; !ok {
			delete(c.minutes, id)
		}
	}
}

// AccrueVoice walks the voice channels once a minute until ctx ends (#467).
// The database work happens on this goroutine, never in the hub.
func (s *Service) AccrueVoice(ctx context.Context, voice VoiceSource) {
	safego.Supervise(s.log, s.now, "voice clock", ctx.Done(), func() { runVoiceClock(ctx, voice, s, s.now) })
}

// runVoiceClock is the ticker loop behind AccrueVoice, pulled out so the
// tests can run it in a synctest bubble against a fake ledger. Exits when
// ctx does.
func runVoiceClock(ctx context.Context, voice VoiceSource, ledger loungeLedger, now func() time.Time) {
	clock := &voiceClock{minutes: make(map[string]int), ledger: ledger}
	ticker := time.NewTicker(voicePoll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			clock.tick(ctx, voice.VoiceRiderIDs(), now())
		}
	}
}

// LoungeBlock implements loungeLedger against the database: the block's ref
// is its minute, so a restart that replays the same minute cannot pay twice,
// and the daily cap is applied in the insert itself.
func (s *Service) LoungeBlock(ctx context.Context, riderID string, at time.Time) {
	userID, err := store.ParseUUID(riderID)
	if err != nil {
		return
	}
	day := at.UTC().Truncate(24 * time.Hour)
	_, err = s.store.Queries.AddLoungeXp(ctx, db.AddLoungeXpParams{
		UserID:     userID,
		DayStart:   pgtype.Timestamptz{Time: day, Valid: true},
		DailyCap:   LoungeDailyCap,
		Ref:        at.UTC().Format("2006-01-02T15:04Z"),
		HappenedAt: pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		s.log.Error("lounge xp failed", "err", err, "rider", riderID)
		return
	}
	if err := s.evaluate(ctx, userID); err != nil {
		s.log.Error("achievement check failed", "err", err, "rider", riderID)
	}
}
