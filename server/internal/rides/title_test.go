package rides

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A rider names a finished ride (#4209): the name rides on the page and the
// list, clears back to the workout's, and moves nothing that groups by the
// workout — Against your best still finds the ride under "Openers".
func TestRideTitleRoundTrips(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	path := "/api/rides/" + id

	if _, body := call(t, h.mux, "alice", http.MethodGet, path, ""); body["title"] != nil {
		t.Fatalf("a fresh ride has a title: %v", body["title"])
	}
	status, body := call(t, h.mux, "alice", http.MethodPatch, path, `{"title":"  Tuesday hill repeats "}`)
	if status != http.StatusOK || body["title"] != "Tuesday hill repeats" {
		t.Fatalf("patch title: %d %v", status, body)
	}
	if _, body := call(t, h.mux, "alice", http.MethodGet, path, ""); body["title"] != "Tuesday hill repeats" || body["workoutName"] != "Openers" {
		t.Fatalf("detail: %v / %v", body["title"], body["workoutName"])
	}
	_, list := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	rides, _ := list["rides"].([]any)
	if len(rides) != 1 {
		t.Fatalf("list: %v", list)
	}
	if first, _ := rides[0].(map[string]any); first["title"] != "Tuesday hill repeats" {
		t.Fatalf("list: %v", list)
	}
	_, best := call(t, h.mux, "bob", http.MethodGet, "/api/rides/best?workout=Openers", "")
	if best["ride"] != nil {
		t.Fatalf("bob sees alice's ride: %v", best)
	}
	_, best = call(t, h.mux, "alice", http.MethodGet, "/api/rides/best?workout=Openers", "")
	if ride, _ := best["ride"].(map[string]any); ride == nil || ride["id"] != id || ride["title"] != "Tuesday hill repeats" {
		t.Fatalf("against your best lost the renamed ride: %v", best)
	}

	// Sharing and naming are one PATCH or two; neither undoes the other.
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, path, `{"sharedWithFriends":true}`); status != http.StatusOK {
		t.Fatalf("share: %d", status)
	}
	if _, body := call(t, h.mux, "alice", http.MethodGet, path, ""); body["title"] != "Tuesday hill repeats" || body["sharedWithFriends"] != true {
		t.Fatalf("share moved the title: %v", body)
	}

	// Spaces are no name: the ride reads as its workout's again.
	if status, body := call(t, h.mux, "alice", http.MethodPatch, path, `{"title":"   "}`); status != http.StatusOK || body["title"] != "" {
		t.Fatalf("clear: %d %v", status, body)
	}
	if _, body := call(t, h.mux, "alice", http.MethodGet, path, ""); body["title"] != nil {
		t.Fatalf("cleared title still served: %v", body["title"])
	}
}

// docs/SPEC.md's 1–80 characters for a workout's name, in runes (#1986), and
// a PATCH that says nothing is refused naming a field (errors.md). Someone
// else's ride reads as absent.
func TestRideTitleRefusals(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	path := "/api/rides/" + id

	fits := strings.Repeat("ü", protocol.MaxWorkoutNameChars)
	if status, body := call(t, h.mux, "alice", http.MethodPatch, path, fmt.Sprintf(`{"title":%q}`, fits)); status != http.StatusOK {
		t.Fatalf("%d runes refused: %d %v", protocol.MaxWorkoutNameChars, status, body)
	}
	for _, tc := range []struct{ name, body, field string }{
		{"too long", fmt.Sprintf(`{"title":%q}`, fits+"ü"), "title"},
		{"nothing", `{}`, "sharedWithFriends"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := call(t, h.mux, "alice", http.MethodPatch, path, tc.body)
			if status != http.StatusBadRequest || body["field"] != tc.field {
				t.Fatalf("refusal: %d %v", status, body)
			}
		})
	}
	if status, _ := call(t, h.mux, "bob", http.MethodPatch, path, `{"title":"mine now"}`); status != http.StatusNotFound {
		t.Fatalf("bob named alice's ride: %d", status)
	}
}

// A personal token is how an AI reads (ADR-0017), and free text can name any
// place (ADR-0063): the title rides on the account's own reads and never on a
// bearer's list.
func TestABearersListCarriesNoTitle(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	title := fmt.Sprintf(`{"title":%q}`, "Up "+testx.Corridor.Places[0])
	if status, body := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+id, title); status != http.StatusOK {
		t.Fatalf("patch: %d %v", status, body)
	}
	for _, path := range []string{"/api/rides", "/api/rides/best?workout=Openers"} {
		status, body := rawGet(t, h, path, true)
		if status != http.StatusOK {
			t.Fatalf("%s with a bearer: %d %s", path, status, body)
		}
		if leak := testx.Leak(body); leak != "" {
			t.Errorf("%s with a bearer carries %q", path, leak)
		}
		if _, own := rawGet(t, h, path, false); !strings.Contains(own, testx.Corridor.Places[0]) {
			t.Errorf("%s without a bearer lost the title: %s", path, own)
		}
	}
}
