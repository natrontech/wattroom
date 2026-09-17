package tokens

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/natrontech/wattroom/server/internal/testx"
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

// The cap has to hold when the requests arrive together, which is the only
// way a cap ever gets tested in anger (#2258). Count-then-insert as two
// statements let every concurrent request read the same count and proceed —
// the shape #824 closed on the removal side and left open here.
func TestTheTokenCapHoldsUnderConcurrentCreates(t *testing.T) {
	mux, svc := setup(t)
	const racers = 16

	var wg sync.WaitGroup
	created := make([]int, racers)
	wg.Add(racers)
	for i := range racers {
		go func() {
			defer wg.Done()
			code, _ := call(t, mux, "alice", http.MethodPost, "/api/tokens", fmt.Sprintf(`{"name":"racer %d"}`, i))
			created[i] = code
		}()
	}
	wg.Wait()

	fake, ok := svc.users.(*testx.Users)
	if !ok {
		t.Fatalf("setup no longer builds the service on a test user source: %T", svc.users)
	}
	alice := fake.ByToken["alice"]
	rows, err := svc.store.Queries.ListUserTokens(t.Context(), alice.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != maxTokensPerUser {
		t.Errorf("%d tokens in the table after %d concurrent creates, want the cap of %d", len(rows), racers, maxTokensPerUser)
	}
	// And the answers agree with the table: exactly ten 201s, the rest 429.
	accepted, refused := 0, 0
	for _, code := range created {
		switch code {
		case http.StatusCreated:
			accepted++
		case http.StatusTooManyRequests:
			refused++
		default:
			t.Errorf("unexpected answer %d", code)
		}
	}
	if accepted != maxTokensPerUser || refused != racers-maxTokensPerUser {
		t.Errorf("%d created / %d refused, want %d / %d", accepted, refused, maxTokensPerUser, racers-maxTokensPerUser)
	}
}
