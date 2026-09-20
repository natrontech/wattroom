package rides

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// feelOf reads the pair back off the ride's own page — the only read that
// serves them (ADR-0055), so it is also the only way to check what was
// stored.
func (h *harness) feelOf(t *testing.T, user, id string) map[string]any {
	t.Helper()
	status, body := call(t, h.mux, user, http.MethodGet, "/api/rides/"+id, "")
	if status != http.StatusOK {
		t.Fatalf("detail: %d %v", status, body)
	}
	feel, ok := body["feel"].(map[string]any)
	if !ok {
		t.Fatalf("detail has no feel: %v", body)
	}
	return feel
}

func TestRideFeelRoundTrips(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)

	// A ride nobody has rated: both halves present and null, so a client can
	// tell "not rated" from "field missing" without guessing.
	feel := h.feelOf(t, "alice", id)
	if feel["rpe"] != nil || feel["note"] != nil {
		t.Fatalf("a fresh ride is unrated: %v", feel)
	}

	status, body := call(t, h.mux, "alice", http.MethodPut, "/api/rides/"+id+"/feel",
		`{"rpe":8,"note":"legs were dead, third day on"}`)
	if status != http.StatusOK {
		t.Fatalf("put feel: %d %v", status, body)
	}
	if body["rpe"] != float64(8) || body["note"] != "legs were dead, third day on" {
		t.Fatalf("put answered: %v", body)
	}
	feel = h.feelOf(t, "alice", id)
	if feel["rpe"] != float64(8) || feel["note"] != "legs were dead, third day on" {
		t.Fatalf("stored: %v", feel)
	}

	// Both halves clear independently, and a note of nothing but spaces is no
	// note — docs/SPEC.md. Stored whitespace would draw an empty note panel
	// on every later visit.
	status, _ = call(t, h.mux, "alice", http.MethodPut, "/api/rides/"+id+"/feel",
		`{"rpe":null,"note":"   "}`)
	if status != http.StatusOK {
		t.Fatalf("clear: %d", status)
	}
	if feel = h.feelOf(t, "alice", id); feel["rpe"] != nil || feel["note"] != nil {
		t.Fatalf("cleared: %v", feel)
	}
}

// The scale's bounds are docs/SPEC.md's, and the column's CHECK would refuse
// an out-of-range rating as a 500 — the boundary answers first, naming the
// field, as errors.md requires.
func TestRideFeelRefusesWhatIsNotOnTheScale(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)

	for _, tc := range []struct {
		name, body, field string
	}{
		// 0 is CR10's "rest"; a saved ride is at least a minute of pedalling.
		{"zero", `{"rpe":0,"note":null}`, "rpe"},
		{"eleven", `{"rpe":11,"note":null}`, "rpe"},
		{"negative", `{"rpe":-3,"note":null}`, "rpe"},
		{"note too long", fmt.Sprintf(`{"rpe":null,"note":%q}`, strings.Repeat("x", protocol.MaxRideNoteChars+1)), "note"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := call(t, h.mux, "alice", http.MethodPut, "/api/rides/"+id+"/feel", tc.body)
			if status != http.StatusBadRequest {
				t.Fatalf("status: %d %v", status, body)
			}
			if body["error"] != "validation_error" || body["field"] != tc.field {
				t.Fatalf("refusal: %v", body)
			}
			if body["message"] == "" {
				t.Fatalf("a refusal says what to do: %v", body)
			}
		})
	}

	// Counted in characters, not bytes (#1986): 500 three-byte runes is a
	// legal note, and a byte-counting bound would refuse it at 1500.
	status, body := call(t, h.mux, "alice", http.MethodPut, "/api/rides/"+id+"/feel",
		fmt.Sprintf(`{"rpe":null,"note":%q}`, strings.Repeat("あ", protocol.MaxRideNoteChars)))
	if status != http.StatusOK {
		t.Fatalf("500 runes is a legal note: %d %v", status, body)
	}

	// An unknown field is a client sending something this does not store.
	if status, _ := call(t, h.mux, "alice", http.MethodPut, "/api/rides/"+id+"/feel",
		`{"rpe":5,"feeling":"great"}`); status != http.StatusBadRequest {
		t.Fatalf("unknown field: %d", status)
	}
	// Not a ride id at all.
	if status, _ := call(t, h.mux, "alice", http.MethodPut, "/api/rides/not-a-uuid/feel",
		`{"rpe":5,"note":null}`); status != http.StatusBadRequest {
		t.Fatalf("bad id: %d", status)
	}
}

func TestRideFeelNeedsTheOwnerSignedIn(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)

	if status, _ := call(t, h.mux, "", http.MethodPut, "/api/rides/"+id+"/feel",
		`{"rpe":5,"note":null}`); status != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", status)
	}
	// A ride of someone else's is absent, not forbidden: a 403 would confirm
	// it exists. Same answer as a ride that never existed.
	status, body := call(t, h.mux, "bob", http.MethodPut, "/api/rides/"+id+"/feel",
		`{"rpe":5,"note":null}`)
	if status != http.StatusNotFound || body["error"] != "not_found" {
		t.Fatalf("another rider's ride: %d %v", status, body)
	}
	if status, _ := call(t, h.mux, "alice", http.MethodPut,
		"/api/rides/00000000-0000-0000-0000-000000000000/feel",
		`{"rpe":5,"note":null}`); status != http.StatusNotFound {
		t.Fatalf("no such ride: %d", status)
	}
}

// ADR-0055: the note is the rider's own. Sharing a ride shares what the
// trainer recorded, and a second rider opening it by id gets the same 404 an
// unrated stranger's ride gets — never the words.
func TestASharedRidesNoteStaysWithItsOwner(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	const written = "row with my partner, rode it off"
	if status, body := call(t, h.mux, "alice", http.MethodPut, "/api/rides/"+id+"/feel",
		fmt.Sprintf(`{"rpe":9,"note":%q}`, written)); status != http.StatusOK {
		t.Fatalf("put feel: %d %v", status, body)
	}
	// The rider flips the ride to shared — the one switch in the product that
	// makes a ride visible to anybody else.
	if status, body := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+id,
		`{"sharedWithFriends":true}`); status != http.StatusOK {
		t.Fatalf("share: %d %v", status, body)
	}

	for _, path := range []string{"/api/rides/" + id, "/api/rides/" + id + "/export"} {
		status, body := call(t, h.mux, "bob", http.MethodGet, path, "")
		if status != http.StatusNotFound {
			t.Fatalf("%s for another rider: %d %v", path, status, body)
		}
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), "row with my partner") {
			t.Fatalf("%s leaked the note: %s", path, raw)
		}
	}

	// And the shared ride as bob's own list would ever see it: the friend-
	// visible projection names its columns, so the note is not in the row at
	// all. Asserted against the query rather than the handler, because that
	// projection is what a future crew or coach surface would reuse.
	rows, err := h.store.Queries.ListSharedRides(t.Context(), db.ListSharedRidesParams{
		Rider: h.users.ByToken["alice"].ID, Viewer: h.users.ByToken["bob"].ID, Max: 10,
	})
	if err != nil {
		t.Fatalf("list shared: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("shared rides: %d", len(rows))
	}
	raw, _ := json.Marshal(rows[0])
	if strings.Contains(string(raw), "row with my partner") || strings.Contains(string(raw), `"Rpe"`) {
		t.Fatalf("the shared projection carries the rider's own words: %s", raw)
	}
}
