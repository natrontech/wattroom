package crews

import (
	"fmt"
	"net/http"
	"testing"
)

// The weekly board's switch is the crew's (ADR-0058, #2454): crew Settings
// writes it, and the crew's own read is what that page — and every voice
// channel after it — reads it back from. The reaction set left the crew for
// the rider (#2722): a crew write carrying one is refused as unreadable.
func TestCrewSettingsSaveTheBoard(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Palette Crew")
	h.join(t, "bob", crew)
	path := crewPath(crew)
	read := func() map[string]any {
		t.Helper()
		status, body := h.call(t, "bob", http.MethodGet, path, "")
		if status != http.StatusOK {
			t.Fatalf("read: %d %v", status, body)
		}
		return body
	}

	if _, ok := read()["cheers"]; ok {
		t.Fatal("the crew still reads out a reaction set")
	}
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Palette Crew","cheers":["flame"]}`); status != http.StatusBadRequest {
		t.Fatalf("a crew palette write: %d %v, want 400", status, body)
	}
	if read()["boardEnabled"] != nil {
		t.Fatal("a new crew reads as keeping a board")
	}
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Palette Crew","boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("board on: %d %v", status, body)
	}
	if read()["boardEnabled"] != true {
		t.Fatal("the board's switch does not read back")
	}
	// A rename leaves the switch where it was: nil keeps.
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Palette Crew Renamed"}`); status != http.StatusOK {
		t.Fatalf("rename: %d %v", status, body)
	}
	if read()["boardEnabled"] != true {
		t.Fatal("a rename turned the board off")
	}
}

// The crew's icon (#447): a key from the set or none, and an emoji picked
// before the set existed still lands, so an old crew keeps its mark.
func TestCrewSettingsSaveTheIcon(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Icon Cave")
	path := crewPath(crew)
	patch := func(body string) (int, map[string]any) {
		return h.call(t, "alice", http.MethodPatch, path, body)
	}

	if _, body := h.call(t, "alice", http.MethodGet, path, ""); body["icon"] != nil {
		t.Errorf("a new crew has an icon: %v", body["icon"])
	}
	// A crew's own emoji is a reaction, not a mark (#2643).
	for _, junk := range []string{"not an icon!", "<script>", ":party_parrot:"} {
		if status, body := patch(fmt.Sprintf(`{"name":"Icon Cave","icon":%q}`, junk)); status != http.StatusBadRequest || body["field"] != "icon" {
			t.Errorf("icon %q: %d %v, want 400 on the icon", junk, status, body)
		}
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"bike"}`); status != http.StatusOK || body["icon"] != "bike" {
		t.Errorf("key icon: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"🦖"}`); status != http.StatusOK || body["icon"] != "🦖" {
		t.Errorf("emoji icon: %d %v", status, body)
	}
	// Absent keeps it; empty clears it.
	if status, body := patch(`{"name":"Icon Cave"}`); status != http.StatusOK || body["icon"] != "🦖" {
		t.Errorf("absent icon did not keep: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":""}`); status != http.StatusOK || body["icon"] != nil {
		t.Errorf("empty icon did not clear: %d %v", status, body)
	}
}
