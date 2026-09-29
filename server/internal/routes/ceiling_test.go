package routes

import (
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/natrontech/wattroom/server/internal/testx"
)

// seed gives who n routes straight into the table, as if kept over months.
func (h *harness) seed(t *testing.T, who string, n int) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(), `
		insert into routes (owner_id, src, name, gen_name, road, road_hash, length_m, gain_m, ele_source)
		select $1, 'gpx', 'Seeded ' || g, 'Road · 3.0 km · 20 m', $2, 'seeded-' || g, 3000, 20, 'file'
		from generate_series(1, $3::integer) g`, h.users.ByToken[who].ID, testx.FlatRoad(3000, 20), n); err != nil {
		t.Fatal(err)
	}
}

func (h *harness) routes(t *testing.T, who string) int {
	t.Helper()
	var n int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from routes where owner_id = $1", h.users.ByToken[who].ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// docs/SPEC.md's shelf ceiling (#3416): an account keeps at most 200 routes.
// The 200th is kept; the next is a 429 that names the number and the way
// out, never a wait — nothing clears it on its own.
func TestAnAccountKeepsAtMost200Routes(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	h.seed(t, "alice", maxRoutesPerAccount-1)
	if status, body := h.call(t, "alice", http.MethodPost, "/api/routes", request); status != http.StatusCreated {
		t.Fatalf("the 200th route: %d %v", status, body)
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/routes", request)
	msg, _ := body["message"].(string)
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" || !strings.Contains(msg, "200 routes") || !strings.Contains(msg, "Delete one") {
		t.Fatalf("the 201st route: %d %v, want 429 naming 200 and the way out", status, body)
	}
	if n := h.routes(t, "alice"); n != maxRoutesPerAccount {
		t.Fatalf("alice keeps %d routes, want %d", n, maxRoutesPerAccount)
	}
	// Bob's ceiling is his own.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/routes", request); status != http.StatusCreated {
		t.Fatalf("bob's first route: %d", status)
	}
}

// Saves at 199 at the same moment keep exactly one: the count is read under
// the rider's row lock, in the transaction that inserts.
func TestSavesAtTheLimitAtOnceKeepExactlyOne(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	h.seed(t, "alice", maxRoutesPerAccount-1)
	const at = 5
	statuses := make([]int, at)
	var wg sync.WaitGroup
	for i := range at {
		wg.Go(func() { statuses[i], _ = h.call(t, "alice", http.MethodPost, "/api/routes", request) })
	}
	wg.Wait()
	if n := h.routes(t, "alice"); n != maxRoutesPerAccount {
		t.Fatalf("%d saves at once left %d routes (%v), want %d", at, n, statuses, maxRoutesPerAccount)
	}
}

// Ten saves a minute: the eleventh waits, and says so.
func TestTheEleventhSaveInAMinuteIsRefused(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	for i := range savesPerWindow {
		if status, body := h.call(t, "alice", http.MethodPost, "/api/routes", request); status != http.StatusCreated {
			t.Fatalf("save %d: %d %v", i+1, status, body)
		}
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/routes", request)
	msg, _ := body["message"].(string)
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" || !strings.Contains(msg, "moment") {
		t.Fatalf("the eleventh save: %d %v, want 429 asking to wait", status, body)
	}
	if n := h.routes(t, "alice"); n != savesPerWindow {
		t.Fatalf("alice keeps %d routes, want %d", n, savesPerWindow)
	}
}
