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
		// The counts travel the way an earned badge does (#993): everyone in
		// the room watched Alice sit in the lounge. It is only how far along
		// she is on an unearned badge that stays hers, asserted just below.
		if body.Counts.VoiceMinutes != blockMinutes {
			t.Fatalf("friend saw voice minutes %d, want %d", body.Counts.VoiceMinutes, blockMinutes)
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
