package crews

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The reaction palette and the weekly board's switch are the crew's
// (ADR-0058, #2454): crew Settings writes them, and the crew's own read is
// what that page — and every voice channel after it — reads them back from.
func TestCrewSettingsSaveThePaletteAndTheBoard(t *testing.T) {
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
	cheers := func(body map[string]any) string {
		list, _ := body["cheers"].([]any)
		var words []string
		for _, c := range list {
			word, _ := c.(string)
			words = append(words, word)
		}
		return strings.Join(words, " ")
	}

	if got := cheers(read()); got != strings.Join(baseCheers, " ") {
		t.Fatalf("a new crew speaks %q, want the base set", got)
	}

	for _, tc := range []struct {
		name, who, body string
		status          int
		want            string
	}{
		{"a member may not", "bob", `{"name":"Palette Crew","cheers":["flame"]}`, http.StatusForbidden, ""},
		{"not an icon", "alice", `{"name":"Palette Crew","cheers":["<b>"]}`, http.StatusBadRequest, ""},
		{"text is not a reaction", "alice", `{"name":"Palette Crew","cheers":["gg!"]}`, http.StatusBadRequest, ""},
		{"a key is lowercase", "alice", `{"name":"Palette Crew","cheers":["Flame"]}`, http.StatusBadRequest, ""},
		{"too many", "alice", fmt.Sprintf(`{"name":"Palette Crew","cheers":[%s]}`,
			strings.TrimSuffix(strings.Repeat(`"flame",`, protocol.MaxCheers+1), ",")), http.StatusBadRequest, ""},
		// A palette picked before #447 was emoji, and it still saves.
		{"an emoji from before icon keys", "alice", `{"name":"Palette Crew","cheers":["🦖","🌵"]}`, http.StatusOK, "🦖 🌵"},
		// Any emoji the picker offers, and the crew's own by name (#2643).
		{"a keycap and a crew emoji", "alice", `{"name":"Palette Crew","cheers":["1️⃣",":party_parrot:"]}`, http.StatusOK, "1️⃣ :party_parrot:"},
		{"a crew emoji is lowercase too", "alice", `{"name":"Palette Crew","cheers":[":Parrot:"]}`, http.StatusBadRequest, ""},
		{"a pick, deduplicated", "alice", `{"name":"Palette Crew","cheers":["rocket","flame","rocket"]}`, http.StatusOK, "rocket flame"},
		{"a rename keeps it", "alice", `{"name":"Palette Crew Two"}`, http.StatusOK, "rocket flame"},
		{"empty is the base set", "alice", `{"name":"Palette Crew","cheers":[]}`, http.StatusOK, strings.Join(baseCheers, " ")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if status, body := h.call(t, tc.who, http.MethodPatch, path, tc.body); status != tc.status {
				t.Fatalf("%d %v, want %d", status, body, tc.status)
			}
			if tc.want != "" {
				if got := cheers(read()); got != tc.want {
					t.Fatalf("the crew speaks %q, want %q", got, tc.want)
				}
			}
		})
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
