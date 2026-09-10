package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func uuid(b byte) pgtype.UUID {
	var id pgtype.UUID
	id.Bytes[0] = b
	id.Valid = true
	return id
}

// The guard's own semantics, without a database in the way. Every case is a
// sequence of moves against one set, because the bug worth catching here is a
// state one: a slot that is never handed back locks a rider out of their own
// data for the life of the process.
func TestInFlightSlotIsOnePerAccount(t *testing.T) {
	alice, bob := uuid(1), uuid(2)

	for _, tc := range []struct {
		name string
		run  func(t *testing.T, f *inFlight)
	}{
		{"a second export for the same account is refused", func(t *testing.T, f *inFlight) {
			if !f.acquire(alice) {
				t.Fatal("the first export was refused the slot")
			}
			if f.acquire(alice) {
				t.Error("a second export took the slot while the first held it")
			}
		}},
		{"the slot comes back on release", func(t *testing.T, f *inFlight) {
			if !f.acquire(alice) {
				t.Fatal("first acquire refused")
			}
			f.release(alice)
			if f.running(alice) {
				t.Error("still marked running after release")
			}
			if !f.acquire(alice) {
				t.Error("the slot did not come back after release")
			}
		}},
		{"one rider's export does not block another's", func(t *testing.T, f *inFlight) {
			if !f.acquire(alice) || !f.acquire(bob) {
				t.Fatal("two accounts should hold a slot each")
			}
			f.release(alice)
			if !f.running(bob) {
				t.Error("releasing alice's slot took bob's")
			}
		}},
		{"a panic hands the slot back", func(t *testing.T, f *inFlight) {
			// The handler's shape: acquire, then `defer release`. This is the
			// path that would otherwise leak, and the reason release is
			// deferred rather than called at the end of the happy path.
			func() {
				defer func() { _ = recover() }()
				if !f.acquire(alice) {
					t.Fatal("acquire refused")
				}
				defer f.release(alice)
				panic("export blew up")
			}()
			if f.running(alice) {
				t.Fatal("a panic leaked the slot — this rider is locked out until restart")
			}
			if !f.acquire(alice) {
				t.Error("the slot did not come back after a panic")
			}
		}},
		{"release is idempotent and minds its own key", func(t *testing.T, f *inFlight) {
			if !f.acquire(alice) {
				t.Fatal("acquire refused")
			}
			f.release(bob) // never held one
			if !f.running(alice) {
				t.Error("releasing a key that held nothing freed alice's slot")
			}
			f.release(alice)
			f.release(alice) // a double defer must not be a second free
			if f.running(alice) {
				t.Error("still running after release")
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.run(t, newInFlight())
		})
	}
}

// Exactly one of many simultaneous exports gets the slot — the double-click
// this ceiling exists for, run under -race.
func TestInFlightGivesTheSlotToExactlyOneCaller(t *testing.T) {
	f := newInFlight()
	alice := uuid(1)

	const callers = 50
	var start sync.WaitGroup
	var done sync.WaitGroup
	start.Add(1)
	var mu sync.Mutex
	won := 0
	for range callers {
		done.Add(1)
		go func() {
			defer done.Done()
			start.Wait()
			if f.acquire(alice) {
				mu.Lock()
				won++
				mu.Unlock()
			}
		}()
	}
	start.Done()
	done.Wait()

	if won != 1 {
		t.Errorf("%d callers got the slot, want exactly 1", won)
	}
}

// The endpoint's half of the ceiling (#1554): the refusal a rider sees, and
// the slot coming back on both the success and the failure path.
func TestExportRefusesASecondExportWhileOneIsInFlight(t *testing.T) {
	h := setup(t)
	room := h.createRoom(t, "alice")
	h.createRide(t, "alice", room, "Openers", gzipped(t, `[{"t":0,"w":200}]`))

	// Stand in for an export already running: the handler holds this slot for
	// as long as it is building the zip, and a second tab arrives to find it
	// taken.
	if !h.svc.exports.acquire(h.id("alice")) {
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
	h.svc.exports.release(h.id("alice"))
	if rec := h.call(t, "alice", http.MethodGet, "/api/me/export"); rec.Code != http.StatusOK {
		t.Errorf("export after the first finished: %d %s, want 200", rec.Code, rec.Body.String())
	}
}

func TestExportHandsTheSlotBackWhenItSucceedsAndWhenItFails(t *testing.T) {
	h := setup(t)
	room := h.createRoom(t, "alice")
	h.createRide(t, "alice", room, "Openers", gzipped(t, `[{"t":0,"w":200}]`))
	alice := h.id("alice")

	// Success: two exports in a row both work, so the handler did not keep
	// the slot it took.
	for i := range 2 {
		if rec := h.call(t, "alice", http.MethodGet, "/api/me/export"); rec.Code != http.StatusOK {
			t.Fatalf("export %d: %d %s, want 200", i+1, rec.Code, rec.Body.String())
		}
		if h.svc.exports.running(alice) {
			t.Fatalf("export %d kept the slot after answering", i+1)
		}
	}

	// Failure: the export dies after it has taken the slot — a cancelled
	// request context fails the first query, which is the earliest thing that
	// can go wrong once the slot is held. This is the path that locks a rider
	// out of their own data if the release is not deferred.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/me/export", nil)
	req.Header.Set("X-Test-User", "alice")
	failed := httptest.NewRecorder()
	h.mux.ServeHTTP(failed, req)
	if failed.Code != http.StatusInternalServerError {
		t.Fatalf("cancelled export: %d %s, want 500 — the test needs a real failure to prove the release", failed.Code, failed.Body.String())
	}
	if h.svc.exports.running(alice) {
		t.Fatal("a failed export leaked the slot — the rider is locked out of their own data")
	}
	if rec := h.call(t, "alice", http.MethodGet, "/api/me/export"); rec.Code != http.StatusOK {
		t.Errorf("export after a failed one: %d %s, want 200", rec.Code, rec.Body.String())
	}
}
