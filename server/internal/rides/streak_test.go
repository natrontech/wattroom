package rides

import (
	"net/http"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/stats"
)

// An upload is always kept, but one that started before the week ahead of
// the one it was saved in builds no streak (#3514): ten one-minute rides
// dated a week apart bought a 10-week streak, and every session ride paid
// its bonus outside the upload ceiling. Last week's ride still counts, as it
// does for anyone who saves the morning after.
func TestABackdatedUploadBuildsNoStreak(t *testing.T) {
	h := setup(t)
	now := time.Now().UTC()
	for weeksAgo := 1; weeksAgo <= 10; weeksAgo++ { // ten: the upload limit is 10 a minute
		start := now.AddDate(0, 0, -7*weeksAgo).Truncate(time.Second)
		if status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBodyAt(60, 250, start)); status != http.StatusCreated {
			t.Fatalf("upload %d weeks back: %d %v — every upload is kept", weeksAgo, status, body)
		}
	}
	// Last week's ride alone counts, where ten contiguous weeks would pay
	// the cap.
	if got := stats.StreakXP(t.Context(), h.store.Queries, h.users.ByToken["alice"].ID, now); int(got) != stats.StreakBonus(1) {
		t.Fatalf("a session save after ten back-dated uploads pays %d streak XP, want %d for last week's ride alone", got, stats.StreakBonus(1))
	}
}
