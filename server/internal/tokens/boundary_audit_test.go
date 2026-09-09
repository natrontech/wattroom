package tokens

import (
	"fmt"
	"net/http"
	"strings"
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
