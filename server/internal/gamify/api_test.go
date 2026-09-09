package gamify

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func get(t *testing.T, mux *http.ServeMux, path, as string) (*httptest.ResponseRecorder, Response) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	if as != "" {
		req.Header.Set("X-Test-User", as)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var body Response
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rec, body
}

func TestTrophies(t *testing.T) {
	s, _, alice, bob := setup(t)
	mux := http.NewServeMux()
	s.Register(mux)
	addRide(t, s, alice, time.Now().Add(-time.Hour), 3600, 720, 100)
	s.LoungeBlock(t.Context(), store.UUIDString(alice.ID), time.Now())

	t.Run("mine", func(t *testing.T) {
		rec, body := get(t, mux, "/api/me/trophies", "alice")
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body)
		}
		if body.Xp.Rides != 100 || body.Xp.Lounge != 1 || body.Xp.Total != 101 {
			t.Fatalf("xp = %+v", body.Xp)
		}
		if body.EnergyKj != 720 {
			t.Fatalf("energy = %d", body.EnergyKj)
		}
		if len(body.Achievements) != len(Catalogue) {
			t.Fatalf("%d achievements, want the whole catalogue", len(body.Achievements))
		}
		var rides, lounge, sufferfest achievementJSON
		for _, a := range body.Achievements {
			switch a.Key {
			case key200Rides:
				rides = a
			case keyLounge:
				lounge = a
			case keySufferfest:
				sufferfest = a
			}
		}
		if rides.Progress == nil || rides.Progress.Have != 1 || rides.Progress.Need != 200 {
			t.Fatalf("200 rides progress = %+v", rides.Progress)
		}
		if lounge.Progress == nil || lounge.Progress.Have != blockMinutes {
			t.Fatalf("lounge progress = %+v", lounge.Progress)
		}
		if sufferfest.Progress != nil || sufferfest.EarnedAt != "" {
			t.Fatalf("a ride achievement shows no progress: %+v", sufferfest)
		}
	})

	t.Run("signed out", func(t *testing.T) {
		rec, _ := get(t, mux, "/api/me/trophies", "")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status %d", rec.Code)
		}
		rec, _ = get(t, mux, "/api/riders/"+store.UUIDString(alice.ID)+"/trophies", "")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status %d", rec.Code)
		}
	})

	t.Run("a stranger is a 404", func(t *testing.T) {
		rec, _ := get(t, mux, "/api/riders/"+store.UUIDString(alice.ID)+"/trophies", "bob")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status %d", rec.Code)
		}
		rec, _ = get(t, mux, "/api/riders/not-an-id/trophies", "bob")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status %d", rec.Code)
		}
	})

	t.Run("a friend sees the case", func(t *testing.T) {
		if err := s.store.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
			RequesterID: bob.ID, AddresseeID: alice.ID,
		}); err != nil {
			t.Fatalf("friend request: %v", err)
		}
		if _, err := s.store.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{
			RequesterID: bob.ID, AddresseeID: alice.ID,
		}); err != nil {
			t.Fatalf("accept: %v", err)
		}
		rec, body := get(t, mux, "/api/riders/"+store.UUIDString(alice.ID)+"/trophies", "bob")
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body)
		}
		if body.EnergyKj != 720 {
			t.Fatalf("friend saw energy %d", body.EnergyKj)
		}
		// The counts stay home with the progress bars, because for the four
		// social badges they are the same integers: serving Alice's voice
		// minutes to a friend hands back exactly the Lounge Lizard progress
		// the loop below asserts is absent, and — once she has earned it —
		// "the value that earned it", which ADR-0027 forbids outright.
		if body.Counts != (countsJSON{}) {
			t.Fatalf("a friend saw the counts: %+v", body.Counts)
		}
		// ADR-0027: an earned badge travels, progress toward an unearned one
		// does not. Alice has a ride and a lounge block, so her OWN case
		// carries progress on both — this endpoint handed all of it to any
		// room-mate or friend until #701. Assert the absence, not a count.
		for _, a := range body.Achievements {
			if a.Progress != nil {
				t.Fatalf("a friend saw progress toward %s: %+v", a.Key, a.Progress)
			}
		}
	})

	t.Run("your own id is you", func(t *testing.T) {
		rec, _ := get(t, mux, "/api/riders/"+store.UUIDString(bob.ID)+"/trophies", "bob")
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body)
		}
		// And the strip does not over-apply: asking for your own case by id
		// still answers with your progress, the same as /api/me/trophies.
		_, mine := get(t, mux, "/api/riders/"+store.UUIDString(alice.ID)+"/trophies", "alice")
		var seen bool
		for _, a := range mine.Achievements {
			if a.Progress != nil {
				seen = true
			}
		}
		if !seen {
			t.Fatal("a rider lost their own progress on the rider path")
		}
	})
}

// The trap the counts exist to avoid: docs/SPEC.md pays lounge blocks past
// the daily cap at 0 XP *so the hours keep counting*. Sum the amount and a
// rider who spent the evening in voice reads as two hours; count the rows and
// they read as the evening they had.
func TestCountsPastTheDailyCap(t *testing.T) {
	s, _, alice, _ := setup(t)
	mux := http.NewServeMux()
	s.Register(mux)

	// One UTC day, well past the cap — each block's ref is its own minute, so
	// they are distinct rows rather than one row replayed.
	day := time.Date(2026, 3, 4, 18, 0, 0, 0, time.UTC)
	const blocks = LoungeDailyCap + 6
	for i := range blocks {
		s.LoungeBlock(t.Context(), store.UUIDString(alice.ID), day.Add(time.Duration(i)*5*time.Minute))
	}

	rec, body := get(t, mux, "/api/me/trophies", "alice")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if body.Xp.Lounge != LoungeDailyCap {
		t.Fatalf("lounge xp = %d, want the cap %d — the cap itself is not what broke", body.Xp.Lounge, LoungeDailyCap)
	}
	if want := int64(blocks * blockMinutes); body.Counts.VoiceMinutes != want {
		t.Fatalf("voice minutes = %d, want %d — hours are row counts, not summed XP", body.Counts.VoiceMinutes, want)
	}
}

// sprint_win, dj_track and coached are paid 0 XP always, so amount says
// nothing about them at all and only N can.
func TestCountsOfTheZeroXpSources(t *testing.T) {
	s, _, alice, _ := setup(t)
	mux := http.NewServeMux()
	s.Register(mux)

	at := time.Date(2026, 3, 4, 18, 0, 0, 0, time.UTC)
	for i := range 3 {
		s.record(t.Context(), store.UUIDString(alice.ID), sourceSprintWin, 0, "sprint"+strconv.Itoa(i), at)
	}
	for i := range 2 {
		s.record(t.Context(), store.UUIDString(alice.ID), sourceDjTrack, 0, "track"+strconv.Itoa(i), at)
	}
	s.record(t.Context(), store.UUIDString(alice.ID), sourceCoached, 0, "coached1", at)

	rec, body := get(t, mux, "/api/me/trophies", "alice")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if body.Counts.SprintWins != 3 || body.Counts.TracksPlayed != 2 || body.Counts.Coached != 1 {
		t.Fatalf("counts = %+v", body.Counts)
	}
	if body.Xp.Total != 0 {
		t.Fatalf("xp total = %d, want 0 — these sources pay nothing and are counted anyway", body.Xp.Total)
	}
}

// A ban keeps the membership row (ADR-0013), so the visibility check has to
// exclude it explicitly or a banned rider keeps reading the room's trophy
// cases — and being read back — after the ban (#1109).
func TestTrophyCaseVisibilityAfterBan(t *testing.T) {
	s, _, alice, bob := setup(t)
	mux := http.NewServeMux()
	s.Register(mux)
	aliceCase := "/api/riders/" + store.UUIDString(alice.ID) + "/trophies"
	bobCase := "/api/riders/" + store.UUIDString(bob.ID) + "/trophies"

	room := shareRoom(t, s, alice, bob)
	if rec, _ := get(t, mux, aliceCase, "bob"); rec.Code != http.StatusOK {
		t.Fatalf("room-mate reading the case: status %d, want 200", rec.Code)
	}

	ban(t, s, room, bob)
	if rec, _ := get(t, mux, aliceCase, "bob"); rec.Code != http.StatusNotFound {
		t.Fatalf("banned rider reading the case: status %d, want 404", rec.Code)
	}
	// Both sides of the join: the room he was banned from is no longer his
	// either, so the members he left behind cannot read him through it.
	if rec, _ := get(t, mux, bobCase, "alice"); rec.Code != http.StatusNotFound {
		t.Fatalf("reading a banned rider's case: status %d, want 404", rec.Code)
	}

	// Friendship is the other branch and outlives the ban, which is correct.
	befriend(t, s, alice, bob)
	if rec, _ := get(t, mux, aliceCase, "bob"); rec.Code != http.StatusOK {
		t.Fatalf("banned but befriended: status %d, want 200", rec.Code)
	}
}

// game_win is a ledger source the check constraint has to accept (#1575):
// the migration widened it, and this is what proves the widening ran.
func TestGameWinLandsInTheLedger(t *testing.T) {
	s, _, alice, _ := setup(t)
	at := time.Date(2026, 3, 4, 18, 0, 0, 0, time.UTC)
	s.record(t.Context(), store.UUIDString(alice.ID), sourceGameWin, 0, "crew@watt-golf@1", at)
	var n int
	if err := s.store.Pool.QueryRow(t.Context(),
		"select count(*) from xp_events where user_id = $1 and source = 'game_win'", alice.ID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("game_win rows: %d (%v)", n, err)
	}
}
