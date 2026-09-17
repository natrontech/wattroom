package tokens

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// The cap is a per-account ceiling, so a 429 (errors.md), not a 409
// (audit 2026-09-09).
func TestTheTokenCapIsA429(t *testing.T) {
	mux, _ := setup(t)
	for i := 0; i < maxTokensPerUser; i++ {
		if code, body := call(t, mux, "alice", http.MethodPost, "/api/tokens", fmt.Sprintf(`{"name":"coach %d"}`, i)); code != http.StatusCreated {
			t.Fatalf("token %d: %d %v", i, code, body)
		}
	}
	code, body := call(t, mux, "alice", http.MethodPost, "/api/tokens", `{"name":"one too many"}`)
	if code != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("the eleventh token: %d %v, want 429 rate_limited", code, body)
	}
	if msg, _ := body["message"].(string); !strings.Contains(msg, "revoke") {
		t.Errorf("message %q does not say what to do", msg)
	}
}

// The cap under a burst (#2258). Count-then-insert in two statements let
// every concurrent request read the same nine and all proceed — the shape
// #824 fixed on the removal side, where LockUser's own comment spells out why
// a count-then-write pair does not hold under READ COMMITTED.
func TestTheTokenCapHoldsUnderParallelCreates(t *testing.T) {
	mux, _ := setup(t)
	// Wide on purpose: the window between the count and the insert is one
	// round trip, so a narrow burst catches the unlocked version only
	// sometimes. Twenty-four racing for one slot catches it every time.
	const burst = 24
	// Nine already there, so a burst of eight is racing for the one slot left.
	for i := 0; i < maxTokensPerUser-1; i++ {
		if code, body := call(t, mux, "alice", http.MethodPost, "/api/tokens", fmt.Sprintf(`{"name":"coach %d"}`, i)); code != http.StatusCreated {
			t.Fatalf("token %d: %d %v", i, code, body)
		}
	}

	// Three rounds: the window between the count and the insert is one round
	// trip, so a single burst catches the unlocked version only sometimes.
	for round := range 3 {
		var wg sync.WaitGroup
		var mu sync.Mutex
		created, refused := 0, 0
		var madeID string
		for i := range burst {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				code, body := call(t, mux, "alice", http.MethodPost, "/api/tokens",
					fmt.Sprintf(`{"name":"burst %d %d"}`, round, i))
				mu.Lock()
				defer mu.Unlock()
				switch code {
				case http.StatusCreated:
					created++
					madeID, _ = body["id"].(string)
				case http.StatusTooManyRequests:
					refused++
				}
			}(i)
		}
		wg.Wait()
		if created != 1 || refused != burst-1 {
			t.Fatalf("round %d: %d created, %d refused; want 1 and %d — the cap is the cap",
				round, created, refused, burst-1)
		}
		// Back to one slot free for the next round. By id, not by the
		// rider's name: the test database is shared across the run, so a
		// lookup by display name finds other packages' alices too (#2083).
		if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/tokens/"+madeID, ""); code != http.StatusNoContent {
			t.Fatalf("round %d: could not revoke the token it made: %d", round, code)
		}
	}

	if code, _ := call(t, mux, "alice", http.MethodGet, "/api/tokens", ""); code != http.StatusOK {
		t.Fatalf("list after the bursts: %d", code)
	}
}
