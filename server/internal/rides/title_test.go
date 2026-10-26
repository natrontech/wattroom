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
	for _, tc := range []struct{ name, body, code, field string }{
		{"too long", fmt.Sprintf(`{"title":%q}`, fits+"ü"), "validation_error", "title"},
		// One line, as a planned session's name is: a newline would print on
		// the card and break the list's row.
		{"two lines", `{"title":"Hill\nday"}`, "validation_error", "title"},
		{"a tab", `{"title":"Hill\tday"}`, "validation_error", "title"},
		{"nothing", `{}`, "validation_error", "sharedWithFriends"},
		// Unreadable names no field rather than the wrong one.
		{"not text", `{"title":5}`, "invalid_request", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := call(t, h.mux, "alice", http.MethodPatch, path, tc.body)
			field, _ := body["field"].(string)
			if status != http.StatusBadRequest || body["error"] != tc.code || field != tc.field {
				t.Fatalf("refusal: %d %v", status, body)
			}
		})
	}
	if status, _ := call(t, h.mux, "bob", http.MethodPatch, path, `{"title":"mine now"}`); status != http.StatusNotFound {
		t.Fatalf("bob named alice's ride: %d", status)
	}
	// A refusal stores nothing, sharing included: one statement or none.
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, path, `{"sharedWithFriends":true,"title":"Hill\nday"}`); status != http.StatusBadRequest {
		t.Fatalf("a bad title with a share: %d", status)
	}
	if _, body := call(t, h.mux, "alice", http.MethodGet, path, ""); body["sharedWithFriends"] != false {
		t.Fatalf("a refused PATCH shared the ride: %v", body["sharedWithFriends"])
	}
}

// The card is drawn to be posted (#3055, #3142): the rider's name for a ride
// titles it off a road, never on one — a road ride with no metres included,
// a session rider the bunch never placed, which only its row marks (#4154).
func TestCardTakesTheTitleOffARoadOnly(t *testing.T) {
	h := setup(t)
	filename := func(id string) string {
		t.Helper()
		w := cardRequest(t, h, "alice", id)
		if w.Code != http.StatusOK {
			t.Fatalf("card: %d %s", w.Code, w.Body.String())
		}
		return w.Header().Get("Content-Disposition")
	}
	off := h.save(t, "alice", 120, 200)
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+off, `{"title":"Hill day"}`); status != http.StatusOK {
		t.Fatalf("patch: %d", status)
	}
	if cd := filename(off); !strings.HasSuffix(cd, `-hill-day.png"`) {
		t.Errorf("an off-road card ignores the title: %q", cd)
	}

	placed := h.save(t, "alice", 120, 200)
	if status, _ := call(t, h.mux, "alice", http.MethodPatch, "/api/rides/"+placed, `{"title":"Hill day"}`); status != http.StatusOK {
		t.Fatalf("patch: %d", status)
	}
	if _, err := h.store.Pool.Exec(t.Context(), "update rides set on_road = true where id = $1::uuid", placed); err != nil {
		t.Fatal(err)
	}
	if cd := filename(placed); !strings.HasSuffix(cd, `-openers.png"`) {
		t.Errorf("a road ride's card carries the title: %q", cd)
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
