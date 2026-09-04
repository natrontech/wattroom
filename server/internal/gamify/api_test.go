package gamify

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
