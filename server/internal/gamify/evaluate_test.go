package gamify

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func TestRideAchievements(t *testing.T) {
	tests := []struct {
		name  string
		facts stats.RideFacts
		want  []string
	}{
		{"an easy hour", stats.RideFacts{Seconds: 3600, AboveFtpSec: 600}, nil},
		{"45 min at threshold", stats.RideFacts{Seconds: 3600, AboveFtpSec: sufferfestSec}, []string{keySufferfest}},
		{"three minutes of Z6", stats.RideFacts{Seconds: 3600, Z6Sec: hotEndSec}, []string{keyHotEnd}},
		{"a short hard ride", stats.RideFacts{Seconds: 1200, AboveSweetSpotSec: 960}, []string{keyEspresso}},
		{"a short ride mostly easy", stats.RideFacts{Seconds: 1200, AboveSweetSpotSec: 900}, nil},
		{"a long hard ride is no espresso", stats.RideFacts{Seconds: espressoMaxSec, AboveSweetSpotSec: espressoMaxSec}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := rideAchievements(tt.facts)
			if len(got) != len(tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("got %v, want %v", got, tt.want)
				}
			}
		})
	}
}

func TestClockCounts(t *testing.T) {
	zurich, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		t.Skip("no tzdata")
	}
	at := func(h, m int) pgtype.Timestamptz {
		return pgtype.Timestamptz{Time: time.Date(2026, 9, 1, h, m, 0, 0, zurich), Valid: true}
	}
	rows := []db.ListUserRideTimesRow{
		{StartedAt: at(6, 30), Seconds: 1800},  // sunrise
		{StartedAt: at(6, 59), Seconds: 60},    // sunrise, just
		{StartedAt: at(7, 0), Seconds: 60},     // not before seven
		{StartedAt: at(22, 30), Seconds: 3600}, // ends 23:30
		{StartedAt: at(23, 30), Seconds: 3600}, // ends past midnight
		{StartedAt: at(21, 0), Seconds: 3600},  // ends 22:00
	}
	sunrise, night := clockCounts(rows, zurich)
	if sunrise != 2 || night != 2 {
		t.Fatalf("sunrise %d night %d, want 2 and 2", sunrise, night)
	}
}

// The lounge ledger pays one XP a block up to the day's cap, then keeps
// recording blocks at zero; the same minute twice is one block.
func TestLoungeBlockCapAndIdempotency(t *testing.T) {
	s, _, alice, _ := setup(t)
	id := store.UUIDString(alice.ID)
	day := time.Date(2026, 9, 2, 8, 0, 0, 0, time.UTC)
	for i := 0; i < LoungeDailyCap+1; i++ {
		s.LoungeBlock(t.Context(), id, day.Add(time.Duration(i)*5*time.Minute))
	}
	got := sources(t, s, alice)[sourceLounge]
	if got.Amount != LoungeDailyCap || got.N != LoungeDailyCap+1 {
		t.Fatalf("lounge amount %d over %d blocks, want %d over %d", got.Amount, got.N, LoungeDailyCap, LoungeDailyCap+1)
	}
	s.LoungeBlock(t.Context(), id, day) // the first minute, again
	if got := sources(t, s, alice)[sourceLounge]; got.N != LoungeDailyCap+1 {
		t.Fatalf("replayed minute counted: %d blocks", got.N)
	}
	// A new day pays again.
	s.LoungeBlock(t.Context(), id, day.Add(24*time.Hour))
	if got := sources(t, s, alice)[sourceLounge]; got.Amount != LoungeDailyCap+1 {
		t.Fatalf("next day did not pay: %d", got.Amount)
	}
}

func TestEvaluateAwardsOnce(t *testing.T) {
	s, _, alice, _ := setup(t)
	need, _ := byKey(keyLounge)
	// Blocks spread over days so the daily cap is not what is under test.
	for i := 0; i < need.Need/blockMinutes; i++ {
		_, err := s.store.Queries.AddXpEvent(t.Context(), db.AddXpEventParams{
			UserID: alice.ID, Source: sourceLounge, Amount: 0,
			Ref: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(i) * time.Hour).Format(time.RFC3339),
			At:  pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			t.Fatalf("seed block: %v", err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := s.evaluate(t.Context(), alice.ID); err != nil {
			t.Fatalf("evaluate: %v", err)
		}
	}
	if !earned(t, s, alice)[keyLounge] {
		t.Fatal("lounge lizard not earned at ten hours")
	}
	got := sources(t, s, alice)[sourceAchievement]
	if got.Amount != int64(need.XP) || got.N != 1 {
		t.Fatalf("achievement paid %d over %d rows, want %d once", got.Amount, got.N, need.XP)
	}
}

func TestSunriseClub(t *testing.T) {
	s, _, alice, _ := setup(t)
	for i := 0; i < 5; i++ {
		addRide(t, s, alice, time.Date(2026, 8, 20+i, 6, 15, 0, 0, time.Local), 1800, 300, 330)
	}
	if err := s.evaluate(t.Context(), alice.ID); err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	got := earned(t, s, alice)
	if !got[keySunrise] || got[keyNightShift] {
		t.Fatalf("earned %v, want sunrise club only", got)
	}
}

func TestRideSavedJudgesTheRide(t *testing.T) {
	s, _, alice, _ := setup(t)
	s.rideSaved(t.Context(), alice.ID, stats.RideFacts{Seconds: 3600, AboveFtpSec: sufferfestSec})
	s.rideSaved(t.Context(), alice.ID, stats.RideFacts{Seconds: 3600, AboveFtpSec: sufferfestSec})
	if !earned(t, s, alice)[keySufferfest] {
		t.Fatal("sufferfest survivor not earned")
	}
	want, _ := byKey(keySufferfest)
	if got := sources(t, s, alice)[sourceAchievement]; got.Amount != int64(want.XP) {
		t.Fatalf("paid %d, want %d once", got.Amount, want.XP)
	}
}

// The session voice bonus goes to whoever was on the call for half the
// timeline of a group session; the coach of a medal-sized field gets a
// Crew Chief tally. Replaying the same close pays nothing more.
func TestSessionClosedPaysVoiceAndCoach(t *testing.T) {
	s, _, alice, bob := setup(t)
	coach, err := s.store.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: "coach", FtpWatts: 250, WeightKg: 70})
	if err != nil {
		t.Fatalf("create coach: %v", err)
	}
	t.Cleanup(func() { _, _ = s.store.Pool.Exec(t.Context(), "delete from users where id = $1", coach.ID) })

	ev := hub.SessionClosed{
		Slug: "velvet", StartedBy: store.UUIDString(coach.ID), Seconds: 1800, At: time.Now(),
		Riders: []hub.SessionRider{
			{ID: store.UUIDString(alice.ID), Rode: true, VoiceSeconds: 1000},
			{ID: store.UUIDString(bob.ID), Rode: true, VoiceSeconds: 600},
			{ID: store.UUIDString(coach.ID), Rode: true, VoiceSeconds: 1800},
		},
	}
	for i := 0; i < 2; i++ {
		s.sessionClosed(t.Context(), ev)
	}
	if got := sources(t, s, alice)[sourceSession]; got.Amount != SessionVoiceXP || got.N != 1 {
		t.Fatalf("alice session xp %d over %d rows, want %d once", got.Amount, got.N, SessionVoiceXP)
	}
	if got := sources(t, s, bob)[sourceSession]; got.N != 0 {
		t.Fatalf("bob was on the call a third of the time and got paid: %+v", got)
	}
	if got := sources(t, s, coach)[sourceCoached]; got.N != 1 || got.Amount != 0 {
		t.Fatalf("coach tally %+v, want one row paying nothing", got)
	}

	// Two riders is a group session; not a Crew Chief field. A short one
	// is neither.
	short := ev
	short.Seconds = groupSessionMinSec - 1
	short.At = ev.At.Add(time.Hour)
	short.Riders = short.Riders[:2]
	s.sessionClosed(t.Context(), short)
	if got := sources(t, s, alice)[sourceSession]; got.N != 1 {
		t.Fatalf("a %ds session paid: %+v", short.Seconds, got)
	}
}
