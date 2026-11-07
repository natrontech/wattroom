package gamify

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
)

type standingHeard struct {
	rider  string
	xp     int64
	streak int
	calls  int
}

func (s *standingHeard) SetStanding(riderID string, totalXp int64, streakWeeks int) {
	s.rider, s.xp, s.streak = riderID, totalXp, streakWeeks
	s.calls++
}

// A saved ride's level and rider streak reach the rooms after its badges are
// judged, so the badge's XP is in the level the room celebrates.
func TestARideSavedTellsTheRoomsTheRidersStanding(t *testing.T) {
	s, _, alice, _ := setup(t)
	heard := &standingHeard{}
	s.SetStanding(heard)
	s.now = func() time.Time { return time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC) }
	// Last week and this one: a streak of two weeks.
	addRide(t, s, alice, time.Date(2026, 11, 4, 7, 0, 0, 0, time.UTC), 3600, 600, 600)
	addRide(t, s, alice, time.Date(2026, 11, 10, 7, 0, 0, 0, time.UTC), 3600, 600, 600)

	s.rideSaved(t.Context(), alice.ID, stats.RideFacts{Seconds: 3600, AboveFtpSec: sufferfestSec})
	s.rideSaved(t.Context(), alice.ID, stats.RideFacts{Seconds: 3600, AboveFtpSec: sufferfestSec})

	badge, _ := byKey(keySufferfest)
	if heard.calls != 2 || heard.rider != store.UUIDString(alice.ID) {
		t.Fatalf("heard %+v, want alice twice", heard)
	}
	if want := int64(1200 + badge.XP); heard.xp != want {
		t.Fatalf("level read at %d XP, want %d with the badge's", heard.xp, want)
	}
	if heard.streak != 2 {
		t.Fatalf("streak %d weeks, want 2", heard.streak)
	}
}
