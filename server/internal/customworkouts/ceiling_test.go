package customworkouts

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fill puts n workouts on a rider's shelf straight through the store — the
// ceiling is what the API is being asked about, so getting to it must not go
// through the thing under test.
func fill(t *testing.T, st *store.Store, owner db.User, n int) {
	t.Helper()
	for i := range n {
		if _, err := st.Queries.CreateWorkout(t.Context(), db.CreateWorkoutParams{
			OwnerID: owner.ID, Name: fmt.Sprintf("Shelf %d", i), Author: owner.DisplayName,
			Definition: json.RawMessage(`{"name":"Shelf","steps":[{"type":"steady","seconds":600,"target":0.7}]}`),
		}); err != nil {
			t.Fatalf("seed workout %d: %v", i, err)
		}
	}
}

// listAll walks every page of the shelf and returns the ids in order, so a
// page boundary that skips or repeats a row shows up as a wrong count or a
// duplicate rather than as nothing at all.
func listAll(t *testing.T, mux *http.ServeMux, user string) []string {
	t.Helper()
	var ids []string
	path := "/api/workouts"
	for pages := 0; ; pages++ {
		if pages > 20 {
			t.Fatal("the shelf never said it was done — paging does not terminate")
		}
		status, body := call(t, mux, user, http.MethodGet, path, "")
		if status != http.StatusOK {
			t.Fatalf("list page %d: %d %v", pages, status, body)
		}
		rows, _ := body["workouts"].([]any)
		for _, row := range rows {
			entry, _ := row.(map[string]any)
			id, _ := entry["id"].(string)
			ids = append(ids, id)
		}
		if more, _ := body["more"].(bool); !more {
			return ids
		}
		before, _ := body["nextBefore"].(string)
		beforeID, _ := body["nextBeforeId"].(string)
		if before == "" || beforeID == "" {
			t.Fatalf("page %d says there is more but hands back no cursor: %v", pages, body)
		}
		path = fmt.Sprintf("/api/workouts?before=%s&beforeId=%s", before, beforeID)
	}
}

// docs/SPEC.md's 200-workout ceiling: the shelf fills, the next save is
// refused with the 429 errors.md gives a per-account ceiling, and deleting
// one makes room again. Without the check in handleCreate the 201 below is
// unbounded.
func TestTheWorkoutShelfCeiling(t *testing.T) {
	mux, st, users := setup(t)
	user := users.ByToken["alice"]
	fill(t, st, user, maxWorkoutsPerAccount-1)

	// One short of the ceiling still saves — the cap refuses the 201st
	// hundredth, not the 200th.
	status, body := call(t, mux, "alice", http.MethodPost, "/api/workouts", valid)
	if status != http.StatusCreated {
		t.Fatalf("save at the ceiling: %d %v", status, body)
	}
	last, _ := body["id"].(string)

	status, body = call(t, mux, "alice", http.MethodPost, "/api/workouts", valid)
	if status != http.StatusTooManyRequests {
		t.Fatalf("save past the ceiling: %d %v, want 429", status, body)
	}
	if body["error"] != "rate_limited" {
		t.Errorf("machine code %v, want rate_limited", body["error"])
	}
	message, _ := body["message"].(string)
	if message == "" {
		t.Fatal("a refusal with no message is a bug (errors.md)")
	}
	if !strings.Contains(message, "200") {
		t.Errorf("message %q does not name the ceiling", message)
	}
	// A ceiling does not clear on its own, so the message must not send the
	// rider away to wait for one that will not.
	for _, wait := range []string{"try again", "in a minute", "wait"} {
		if strings.Contains(strings.ToLower(message), wait) {
			t.Errorf("message %q tells the rider to wait for a ceiling that never clears", message)
		}
	}

	// The shelf still reads at the ceiling, and the rider is not locked out
	// of the delete that is the way back down.
	if got := len(listAll(t, mux, "alice")); got != maxWorkoutsPerAccount {
		t.Fatalf("shelf reads %d at the ceiling, want %d", got, maxWorkoutsPerAccount)
	}
	if status, _ := call(t, mux, "alice", http.MethodDelete, "/api/workouts/"+last, ""); status != http.StatusNoContent {
		t.Fatalf("delete at the ceiling: %d", status)
	}
	if status, body := call(t, mux, "alice", http.MethodPost, "/api/workouts", valid); status != http.StatusCreated {
		t.Fatalf("save after making room: %d %v", status, body)
	}

	// Another rider's shelf is their own — the count is per account.
	if status, body := call(t, mux, "bob", http.MethodPost, "/api/workouts", valid); status != http.StatusCreated {
		t.Fatalf("bob's first save: %d %v", status, body)
	}
}

// A shelf that predates the ceiling keeps working: every row still reads,
// through paging rather than despite it, and deleting is still open. Only
// creating refuses. This is the case the old `limit 1000` got wrong in the
// other direction — it hid the overflow instead of refusing it.
func TestAShelfOverTheCeilingStillReadsAndDeletes(t *testing.T) {
	mux, st, users := setup(t)
	user := users.ByToken["alice"]
	const over = maxWorkoutsPerAccount + 15
	fill(t, st, user, over)

	ids := listAll(t, mux, "alice")
	if len(ids) != over {
		t.Fatalf("read %d of %d rows — the read is hiding what the ceiling cannot", len(ids), over)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("id %s came back twice — the page boundary repeats rows", id)
		}
		seen[id] = true
	}

	if status, body := call(t, mux, "alice", http.MethodPost, "/api/workouts", valid); status != http.StatusTooManyRequests {
		t.Fatalf("save over the ceiling: %d %v, want 429", status, body)
	}
	if status, _ := call(t, mux, "alice", http.MethodDelete, "/api/workouts/"+ids[0], ""); status != http.StatusNoContent {
		t.Fatalf("delete over the ceiling: %d — the rider is locked in", status)
	}
}

// Rows sharing one created_at are the case a timestamp-only cursor steps
// over: now() is the transaction's clock, so a batch written in one
// transaction has no order of its own. The id tie-break is what makes the
// page boundary safe, and this is the test that fails without it.
func TestPagingDoesNotSkipRowsSavedInOneTransaction(t *testing.T) {
	mux, st, users := setup(t)
	user := users.ByToken["alice"]

	const rows = 250
	tx, err := st.Pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	q := st.Queries.WithTx(tx)
	for i := range rows {
		if _, err := q.CreateWorkout(t.Context(), db.CreateWorkoutParams{
			OwnerID: user.ID, Name: fmt.Sprintf("Batch %d", i), Author: user.DisplayName,
			Definition: json.RawMessage(`{"name":"Batch","steps":[{"type":"steady","seconds":600,"target":0.7}]}`),
		}); err != nil {
			t.Fatalf("batch insert %d: %v", i, err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if got := len(listAll(t, mux, "alice")); got != rows {
		t.Fatalf("read %d of %d rows saved in one transaction", got, rows)
	}
}

// The ceiling holds under a burst: the count runs with the rider's row
// locked, inside the transaction that inserts, so parallel saves cannot each
// read the same count and each write (#1413's lesson).
func TestTheShelfCeilingHoldsUnderParallelSaves(t *testing.T) {
	mux, st, users := setup(t)
	user := users.ByToken["alice"]
	const room = 3
	fill(t, st, user, maxWorkoutsPerAccount-room)

	var wg sync.WaitGroup
	var mu sync.Mutex
	created := 0
	for i := range room * 3 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, _ := call(t, mux, "alice", http.MethodPost, "/api/workouts", valid)
			mu.Lock()
			defer mu.Unlock()
			if status == http.StatusCreated {
				created++
			}
		}(i)
	}
	wg.Wait()
	if created != room {
		t.Fatalf("%d saves landed in %d slots", created, room)
	}
}

// A half cursor is a 400, not a page read from a time with no tie-break.
func TestTheShelfCursorIsAPair(t *testing.T) {
	mux, _, _ := setup(t)
	for name, path := range map[string]string{
		"time alone":      "/api/workouts?before=2026-09-10T10:00:00Z",
		"id alone":        "/api/workouts?beforeId=00000000-0000-0000-0000-000000000001",
		"unparsable time": "/api/workouts?before=yesterday&beforeId=00000000-0000-0000-0000-000000000001",
		"unparsable id":   "/api/workouts?before=2026-09-10T10:00:00Z&beforeId=nope",
	} {
		t.Run(name, func(t *testing.T) {
			status, body := call(t, mux, "alice", http.MethodGet, path, "")
			if status != http.StatusBadRequest || body["error"] != "validation_error" {
				t.Fatalf("%s: %d %v", path, status, body)
			}
			if msg, _ := body["message"].(string); msg == "" {
				t.Error("a refusal with no message is a bug (errors.md)")
			}
		})
	}
}

// Why the cursor is a type with no half (#2085). Postgres does not refuse
// `(created_at, id) < (:before, null)`: the row comparison yields NULL for
// every row that ties on created_at, so those rows are filtered and the read
// comes back a successful, short page. Nothing errors and nothing logs — the
// silent skip #1414 and #2064 were about.
//
// That is why every paged list narrows its query through keyset.Cursor.Apply,
// which hands over both halves or neither: a fourth list that set `Before`
// and forgot `BeforeID` would reintroduce this with a 200. The rows sharing
// one created_at come from one transaction, as they do in the shelf.
func TestAHalfCursorSkipsSilentlyInTheQuery(t *testing.T) {
	_, st, users := setup(t)
	user := users.ByToken["alice"]

	const rows = 5
	tx, err := st.Pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	q := st.Queries.WithTx(tx)
	for i := range rows {
		if _, err := q.CreateWorkout(t.Context(), db.CreateWorkoutParams{
			OwnerID: user.ID, Name: fmt.Sprintf("Tied %d", i), Author: user.DisplayName,
			Definition: json.RawMessage(`{"name":"Tied","steps":[{"type":"steady","seconds":600,"target":0.7}]}`),
		}); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit: %v", err)
	}

	all, err := st.Queries.ListUserWorkouts(t.Context(), db.ListUserWorkoutsParams{
		OwnerID: user.ID, Limit: rows,
	})
	if err != nil || len(all) != rows {
		t.Fatalf("first page: %d rows, %v", len(all), err)
	}
	boundary := all[0].CreatedAt
	if !all[rows-1].CreatedAt.Time.Equal(boundary.Time) {
		t.Fatal("the batch did not share one created_at — the tie this test needs is gone")
	}

	half, err := st.Queries.ListUserWorkouts(t.Context(), db.ListUserWorkoutsParams{
		OwnerID: user.ID, Limit: rows,
		Before: boundary, // and no BeforeID — the mistake under test
	})
	if err != nil {
		t.Fatalf("a half cursor errored, so the type is no longer the only guard: %v", err)
	}
	if len(half) != 0 {
		t.Fatalf("half-cursor read returned %d rows — re-derive what the trap looks like now", len(half))
	}

	whole, err := st.Queries.ListUserWorkouts(t.Context(), db.ListUserWorkoutsParams{
		OwnerID: user.ID, Limit: rows,
		Before: boundary, BeforeID: all[0].ID,
	})
	if err != nil {
		t.Fatalf("whole cursor: %v", err)
	}
	if len(whole) != rows-1 {
		t.Fatalf("the whole cursor read %d of the %d tied rows the half one dropped", len(whole), rows-1)
	}
}
