package wardrobe

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
)

// One outfit, one hash (#3155), however its keys were ordered or spaced.
func TestALookGoesByOneHash(t *testing.T) {
	a, err := canonicalLook([]byte(`{"frame":"frame.race","colours":{"jerseyA":"snow","jerseyB":"enzian"}}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := canonicalLook([]byte(`{ "colours": { "jerseyB": "enzian", "jerseyA": "snow" }, "frame": "frame.race" }`))
	if err != nil {
		t.Fatal(err)
	}
	if lookHash(a) != lookHash(b) || len(lookHash(a)) != lookHashLen {
		t.Errorf("one outfit hashes %q and %q", lookHash(a), lookHash(b))
	}
}

// The free choices other riders' clients draw are bounded in shape and size.
func TestTheFreeChoicesAreBounded(t *testing.T) {
	for _, c := range []struct {
		name, loadout string
		ok            bool
	}{
		{"words and numbers", `{"skin":"skin.3","colours":{"jerseyA":"snow"},"params":{"tyreMm":28}}`, true},
		{"a nested object", `{"colours":{"jerseyA":{"deep":"snow"}}}`, false},
		{"a list", `{"opts":["a","b"]}`, false},
		{"a long word", `{"skin":"` + strings.Repeat("x", maxLookValue+1) + `"}`, false},
		{"a huge outfit", `{"colours":{"a":"` + strings.Repeat("y", maxLookValue) + `"}}`, true},
	} {
		var loadout map[string]json.RawMessage
		if err := json.Unmarshal([]byte(c.loadout), &loadout); err != nil {
			t.Fatal(err)
		}
		if got := checkLooks(loadout, len(c.loadout)) == ""; got != c.ok {
			t.Errorf("%s: accepted %v, want %v (%s)", c.name, got, c.ok, checkLooks(loadout, len(c.loadout)))
		}
	}
	if checkLooks(map[string]json.RawMessage{}, maxLookBytes+1) == "" {
		t.Error("an outfit past the size bound was accepted")
	}
}

// Saving an outfit names its look; the look answers by that hash, for good;
// an undo that takes an item off names the look it leaves.
func TestAnOutfitIsWornAsALook(t *testing.T) {
	h := setup(t)
	if status, body := h.call(t, "alice", http.MethodPut, "/api/me/outfit", `{"frame":"frame.race","skin":"skin.3"}`); status != http.StatusNoContent {
		t.Fatalf("outfit: %d %v", status, body)
	}
	hash, err := h.st.Queries.UserLookHash(t.Context(), h.id("alice"))
	if err != nil || hash == nil || len(*hash) != lookHashLen {
		t.Fatalf("the outfit's look: %v (%v)", hash, err)
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/looks/"+*hash, nil)
	req.Header.Set("X-Test-User", "bob")
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	// Content-addressed: the body a client is handed hashes to its name.
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"skin":"skin.3"`) ||
		lookHash(w.Body.Bytes()) != *hash || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("the look: %d %s %q", w.Code, w.Body.String(), w.Header().Get("Cache-Control"))
	}
	for path, want := range map[string]int{"/api/looks/not-a-hash": 400, "/api/looks/0123456789abcdef": 404} {
		if status, _ := h.call(t, "alice", http.MethodGet, path, ""); status != want {
			t.Errorf("%s: %d, want %d", path, status, want)
		}
	}
}

// Cosmetics never move anybody (#3155): the hub — and the race engine,
// once it has a package — must not reach the wardrobe, even through another
// package. The whole import graph is read, not one file's imports.
func TestTheWardrobeStaysOutOfWhatMovesRiders(t *testing.T) {
	cmd := exec.CommandContext(t.Context(), "go", "list", "-deps", "-f", "{{.ImportPath}}", "./internal/hub")
	cmd.Dir = "../.."
	if races, _ := exec.CommandContext(t.Context(), "sh", "-c", "cd ../.. && ls -d internal/race* 2>/dev/null").Output(); len(races) > 0 {
		for _, dir := range strings.Fields(string(races)) {
			cmd.Args = append(cmd.Args, "./"+dir)
		}
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go list: %v\n%s", err, out)
	}
	for _, dep := range strings.Fields(string(out)) {
		if strings.HasSuffix(dep, "/internal/wardrobe") {
			t.Fatalf("%s reaches the wardrobe: what someone wears must never move anybody", strings.Join(cmd.Args[5:], " "))
		}
	}
}
