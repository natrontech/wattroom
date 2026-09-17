package rides

import (
	"net/http"
	"testing"
)

// POST /api/rides was the one rider-created row with no ceiling and no rate
// limit (#2251), while every neighbour in the same slice has one — custom
// workouts 200 per account, MCP 60 calls a minute ("a read token was a write
// amplifier with no ceiling"), OG cards 30 a minute, feedback one per ten
// seconds. There is no global limiter in secured() and none at the edge, and
// each row here is up to 4 MB that GET /api/me/export later builds in memory.
func TestSavingRidesHasACeiling(t *testing.T) {
	h := setup(t)

	for i := range savesPerWindow {
		if status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(90, 200)); status != http.StatusCreated {
			t.Fatalf("save %d: %d %v, want 201", i, status, body)
		}
	}
	status, body := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(90, 200))
	if status != http.StatusTooManyRequests {
		t.Fatalf("save %d: %d %v, want 429", savesPerWindow+1, status, body)
	}
	if body["error"] != "rate_limited" || body["message"] == "" {
		t.Errorf("not errors.md's shape: %v", body)
	}

	// Per account, not per server: one rider's loop must not stop another
	// rider saving the ride they just finished.
	if status, body := call(t, h.mux, "bob", http.MethodPost, "/api/rides", rideBody(90, 200)); status != http.StatusCreated {
		t.Errorf("another rider was refused by someone else's ceiling: %d %v", status, body)
	}

	// The ceiling is spent before the body is read, so a loop cannot make the
	// server parse 4 MB apiece to be refused.
	if status, _ := call(t, h.mux, "alice", http.MethodPost, "/api/rides", `{`); status != http.StatusTooManyRequests {
		t.Errorf("a refused caller still had their body parsed: %d, want 429", status)
	}
}
