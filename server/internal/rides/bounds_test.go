package rides

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
)

// rideCount is how many rides a rider has on the account.
func (h *harness) rideCount(t *testing.T, user string) int {
	t.Helper()
	var n int
	if err := h.store.Pool.QueryRow(t.Context(),
		"select count(*) from rides where user_id = $1", h.users.ByToken[user].ID).Scan(&n); err != nil {
		t.Fatalf("count rides: %v", err)
	}
	return n
}

// POST /api/rides trusts the samples it is sent (#3044), and its only key
// was the exact start — so ten saves a minute, each a few seconds apart, were
// ten rides and ten payouts for one minute of anybody's time. Nobody rides
// two at once: whatever shares a second with a saved ride is refused.
func TestOverlappingUploadsEarnOneRide(t *testing.T) {
	h := setup(t)
	start := nextStart()
	for i := range savesPerWindow {
		status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides",
			rideBodyAt(120, 400, start.Add(time.Duration(i)*5*time.Second)))
		want := http.StatusConflict
		if i == 0 {
			want = http.StatusCreated
		}
		if status != want {
			t.Fatalf("save %d: %d %v, want %d", i, status, body, want)
		}
		if i > 0 && (body["error"] != "conflict" || body["message"] == "") {
			t.Fatalf("save %d: not errors.md's shape: %v", i, body)
		}
	}
	if n := h.rideCount(t, "alice"); n != 1 {
		t.Fatalf("%d rides from %d overlapping saves, want 1", n, savesPerWindow)
	}

	// The refusal is about sharing a second, not being near one: a ride that
	// starts the second the last one ended is the next ride, and a retry of
	// the first — its exact start — is still the same ride handed back.
	status, body := call(t, h.mux, "bob", http.MethodPost, "/api/rides", rideBodyAt(120, 200, start))
	if status != http.StatusCreated {
		t.Fatalf("bob's first: %d %v", status, body)
	}
	if status, body := call(t, h.mux, "bob", http.MethodPost, "/api/rides",
		rideBodyAt(120, 200, start.Add(120*time.Second))); status != http.StatusCreated {
		t.Fatalf("a ride starting as the last one ended was refused: %d %v", status, body)
	}
	if status, again := call(t, h.mux, "bob", http.MethodPost, "/api/rides",
		rideBodyAt(120, 200, start)); status != http.StatusOK || again["id"] != body["id"] {
		t.Fatalf("a retry of a saved ride: %d %v, want 200 and id %v", status, again, body["id"])
	}
}

// What uploads can pay in a UTC save day has a ceiling (#3044), and deleting
// a ride does not hand it back: ADR-0047's offset keeps a deleted ride's XP,
// so without the ceiling delete-and-repost minted the same ride again and
// again.
func TestUploadedRidesPayAtMostTheDailyCeiling(t *testing.T) {
	h := setup(t)
	// An hour at 2000 W is 7,200 kJ: over the ceiling on its own.
	start := nextStart()
	status, first := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBodyAt(3600, 2000, start))
	if status != http.StatusCreated {
		t.Fatalf("first: %d %v", status, first)
	}
	if xp, _ := first["xp"].(float64); xp != maxUploadXpPerDay {
		t.Fatalf("first ride paid %v, want the ceiling %d", xp, maxUploadXpPerDay)
	}
	id, _ := first["id"].(string)
	if status, body := call(t, h.mux, "alice", http.MethodDelete, "/api/rides/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d %v", status, body)
	}
	// The same ride again, and another one besides.
	for i, at := range []time.Time{start, nextStart()} {
		status, again := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBodyAt(3600, 2000, at))
		if status != http.StatusCreated {
			t.Fatalf("repost %d: %d %v", i, status, again)
		}
		if xp, _ := again["xp"].(float64); xp != 0 {
			t.Fatalf("repost %d paid %v past a spent ceiling, want 0", i, xp)
		}
	}
	if total := h.totalXp(t, "alice"); total != maxUploadXpPerDay {
		t.Fatalf("lifetime xp %d after delete and repost, want the ceiling %d", total, maxUploadXpPerDay)
	}

	// One rider's day is theirs: bob starts from nothing.
	if status, body := call(t, h.mux, "bob", http.MethodPost, "/api/rides", rideBody(120, 200)); status != http.StatusCreated || body["xp"].(float64) == 0 {
		t.Fatalf("another rider paid nothing under someone else's ceiling: %d %v", status, body)
	}
}

// The ceiling is for scripts, not riders (#3044): two hours at IF 0.9 pays
// exactly what the formula says it did before the ceiling existed.
func TestARealRideIsUntouchedByTheCeiling(t *testing.T) {
	h := setup(t)
	const seconds, watts = 2 * 3600, 225 // 0.9 × alice's 250 W
	start := nextStart()
	status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBodyAt(seconds, watts, start))
	if status != http.StatusCreated {
		t.Fatalf("save: %d %v", status, got)
	}
	samples := make([]protocol.RiderMetrics, seconds)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: watts, Cadence: 90, Seq: i}
	}
	workoutJSON := fmt.Sprintf(`{"name":"Openers","steps":[{"type":"steady","seconds":%d,"target":0.8}]}`, seconds)
	row, err := stats.BuildRideRow(h.users.ByToken["alice"].ID, "Openers", workoutJSON, start, 250, samples)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	// A first ride on a fresh account: no streak to add.
	if xp, _ := got["xp"].(float64); int32(xp) != row.Xp {
		t.Fatalf("a 2 h ride at IF 0.9 paid %v, want the formula's %d", xp, row.Xp)
	}
}
