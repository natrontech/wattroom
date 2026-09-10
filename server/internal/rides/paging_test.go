package rides

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// seedRides puts n rides on a rider's history straight through the store,
// spaced by `gap`. The API cannot make them: its `startedAt` is RFC 3339 to
// the second, and sub-second starts are the case under test.
func (h *harness) seedRides(t *testing.T, user string, n int, from time.Time, gap time.Duration) {
	t.Helper()
	id := h.users.ByToken[user].ID
	for i := range n {
		if _, err := h.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
			UserID: id, WorkoutName: fmt.Sprintf("Seed %d", i),
			StartedAt: pgtype.Timestamptz{Time: from.Add(time.Duration(i) * gap), Valid: true},
			Seconds:   600, AvgWatts: 200, Kj: 120, Execution: 1, ExecutionScored: true,
			FtpWatts: 250, Samples: []byte(`[]`), Curve: []byte(`{}`), Xp: 10,
		}); err != nil {
			t.Fatalf("seed ride %d: %v", i, err)
		}
	}
}

// listAllRides walks every page with the cursor the server hands back, and
// returns the ids in order — so a page boundary that skips or repeats a ride
// shows up as a wrong count or a duplicate rather than as nothing at all.
func listAllRides(t *testing.T, h *harness, user string) []string {
	t.Helper()
	var ids []string
	path := "/api/rides"
	for page := 0; ; page++ {
		if page > 20 {
			t.Fatal("the list never said it was done — paging does not terminate")
		}
		status, body := call(t, h.mux, user, http.MethodGet, path, "")
		if status != http.StatusOK {
			t.Fatalf("page %d: %d %v", page, status, body)
		}
		rows, _ := body["rides"].([]any)
		for _, row := range rows {
			fields, _ := row.(map[string]any)
			id, _ := fields["id"].(string)
			ids = append(ids, id)
		}
		if more, _ := body["more"].(bool); !more {
			return ids
		}
		before, _ := body["nextBefore"].(string)
		beforeID, _ := body["nextBeforeId"].(string)
		if before == "" || beforeID == "" {
			t.Fatalf("page %d says there is more but hands back no cursor: %v", page, body)
		}
		path = fmt.Sprintf("/api/rides?before=%s&beforeId=%s", before, beforeID)
	}
}

// Rides inside one second are the case a second-precision cursor steps over
// (#2064): `/history` paged on the oldest row's own `startedAt`, which the
// list serialises to the second, so the boundary read `started_at < that
// second` and every ride within it went unread — including ones the page had
// not handed over. This is the test that fails without the (started_at, id)
// cursor, and it failed by exactly one ride when it was written.
func TestRidePagingDoesNotSkipRidesInsideOneSecond(t *testing.T) {
	h := setup(t)
	const rides = listPage + 3
	// Two rides per second, so every page boundary lands inside one.
	h.seedRides(t, "alice", rides, time.Now().Add(-72*time.Hour).Truncate(time.Second), 500*time.Millisecond)

	ids := listAllRides(t, h, "alice")
	if len(ids) != rides {
		t.Fatalf("paging read %d of %d rides — the cursor skipped %d", len(ids), rides, rides-len(ids))
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("ride %s came back twice — the page boundary repeats rows", id)
		}
		seen[id] = true
	}
}

// A half cursor is a 400, not a page read from a time with no tie-break.
func TestTheRideCursorIsAPair(t *testing.T) {
	h := setup(t)
	for name, path := range map[string]string{
		"time alone":      "/api/rides?before=2026-09-10T10:00:00Z",
		"id alone":        "/api/rides?beforeId=00000000-0000-0000-0000-000000000001",
		"unparsable time": "/api/rides?before=yesterday&beforeId=00000000-0000-0000-0000-000000000001",
		"unparsable id":   "/api/rides?before=2026-09-10T10:00:00Z&beforeId=nope",
	} {
		t.Run(name, func(t *testing.T) {
			status, body := call(t, h.mux, "alice", http.MethodGet, path, "")
			if status != http.StatusBadRequest || body["error"] != "validation_error" {
				t.Fatalf("%s: %d %v", path, status, body)
			}
			if msg, _ := body["message"].(string); msg == "" {
				t.Error("a refusal with no message is a bug (errors.md)")
			}
		})
	}
}

// One start per rider, in the database (#2064): FindRideAt spares a retry the
// error, but the constraint is what makes two saves racing each other
// impossible rather than unlikely.
func TestOneStartPerRiderIsAConstraint(t *testing.T) {
	h := setup(t)
	at := time.Now().Add(-96 * time.Hour).Truncate(time.Second)
	h.seedRides(t, "alice", 1, at, 0)

	h.seedRides(t, "bob", 1, at, 0) // another rider's ride at the same start is fine

	alice := h.users.ByToken["alice"].ID
	_, err := h.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: alice, WorkoutName: "Racing insert",
		StartedAt: pgtype.Timestamptz{Time: at, Valid: true},
		Seconds:   600, AvgWatts: 200, Kj: 120, Execution: 1, ExecutionScored: true,
		FtpWatts: 250, Samples: []byte(`[]`), Curve: []byte(`{}`), Xp: 10,
	})
	if err == nil {
		t.Fatal("a second ride at the same start inserted — the unique index is missing")
	}
}
