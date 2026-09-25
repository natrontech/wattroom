package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// The endpoint's half of the ceiling (#1554): the refusal a rider sees, and
// the slot coming back on both the success and the failure path.
func TestExportRefusesASecondExportWhileOneIsInFlight(t *testing.T) {
	h := setup(t)
	place := h.createCrew(t, "alice")
	h.createRide(t, "alice", place, "Openers", gzipped(t, `[{"t":0,"w":200}]`))

	// Stand in for an export already running: the handler holds this slot for
	// as long as it is building the zip, and a second tab arrives to find it
	// taken.
	if !h.svc.exports.Acquire(h.id("alice")) {
		t.Fatal("could not hold the slot")
	}
	rec := h.call(t, "alice", http.MethodGet, "/api/me/export")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second export: %d %s, want 429", rec.Code, rec.Body.String())
	}
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("refusal is not the API error shape: %v", err)
	}
	// errors.md: 429 carries rate_limited, and the message tells the rider to
	// wait rather than blaming what they sent.
	if body.Error != "rate_limited" {
		t.Errorf("error = %q, want rate_limited", body.Error)
	}
	if body.Message == "" {
		t.Error("a refusal with no message is not an actionable error")
	}

	// Another rider is untouched by alice's export.
	if rec := h.call(t, "bob", http.MethodGet, "/api/me/export"); rec.Code != http.StatusOK {
		t.Errorf("bob's export: %d %s, want 200 — one rider's ceiling is not everyone's", rec.Code, rec.Body.String())
	}

	// And once alice's finishes, hers works again.
	h.svc.exports.Release(h.id("alice"))
	if rec := h.call(t, "alice", http.MethodGet, "/api/me/export"); rec.Code != http.StatusOK {
		t.Errorf("export after the first finished: %d %s, want 200", rec.Code, rec.Body.String())
	}
}

func TestExportHandsTheSlotBackWhenItSucceedsAndWhenItFails(t *testing.T) {
	h := setup(t)
	place := h.createCrew(t, "alice")
	h.createRide(t, "alice", place, "Openers", gzipped(t, `[{"t":0,"w":200}]`))
	alice := h.id("alice")

	// Success: two exports in a row both work, so the handler did not keep
	// the slot it took.
	for i := range 2 {
		if rec := h.call(t, "alice", http.MethodGet, "/api/me/export"); rec.Code != http.StatusOK {
			t.Fatalf("export %d: %d %s, want 200", i+1, rec.Code, rec.Body.String())
		}
		if h.svc.exports.Running(alice) {
			t.Fatalf("export %d kept the slot after answering", i+1)
		}
	}

	// Failure: the export dies after it has taken the slot — an expired
	// request deadline fails the first query, which is the earliest thing that
	// can go wrong once the slot is held. This is the path that locks a rider
	// out of their own data if the release is not deferred.
	ctx, cancel := context.WithDeadline(context.Background(), time.Now())
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/me/export", nil)
	req.Header.Set("X-Test-User", "alice")
	failed := httptest.NewRecorder()
	h.mux.ServeHTTP(failed, req)
	if failed.Code != http.StatusInternalServerError {
		t.Fatalf("expired export: %d %s, want 500 — the test needs a real failure to prove the release", failed.Code, failed.Body.String())
	}
	if h.svc.exports.Running(alice) {
		t.Fatal("a failed export leaked the slot — the rider is locked out of their own data")
	}
	if rec := h.call(t, "alice", http.MethodGet, "/api/me/export"); rec.Code != http.StatusOK {
		t.Errorf("export after a failed one: %d %s, want 200", rec.Code, rec.Body.String())
	}
}

// The export is the largest and most sensitive artifact this server hands out
// — every ride's heart rate (ADR-0008), the calendar and unsubscribe tokens,
// every crew's code, the rider's own uploads — and a 200 with no directive is
// heuristically cacheable (RFC 9111 §4.2.2), on a stack self-hosters put a
// proxy in front of. httpx says this on every JSON answer and #1688 said it on
// the calendar feeds; this one was missed (#2250).
func TestTheExportIsNotCacheable(t *testing.T) {
	h := setup(t)
	place := h.createCrew(t, "alice")
	h.createRide(t, "alice", place, "Openers", gzipped(t, `[{"t":0,"w":200}]`))

	rec := h.call(t, "alice", http.MethodGet, "/api/me/export")
	if rec.Code != http.StatusOK {
		t.Fatalf("export: %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Errorf("Cache-Control %q, want \"private, no-store\"", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options %q, want \"nosniff\"", got)
	}
}
