package rooms

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// The reaction palette and the weekly board's switch moved up to the crew
// (ADR-0058, #2454): crew Settings writes them, and the crew's own read is
// what that page — and every voice channel after it — reads them back from.
func TestCrewSettingsSaveThePaletteAndTheBoard(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Palette Room")
	h.enter(t, "bob", code, slug)
	path := "/api/crews/" + store.UUIDString(h.crewOf(t, slug).ID)
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
		{"too many", "alice", fmt.Sprintf(`{"name":"Palette Crew","cheers":[%s]}`,
			strings.TrimSuffix(strings.Repeat(`"flame",`, protocol.MaxCheers+1), ",")), http.StatusBadRequest, ""},
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
}
