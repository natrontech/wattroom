package account

import (
	"encoding/json"
	"strings"
	"testing"
)

// What a rider owns and wears travels with the export (#3153, ADR-0053).
func TestExportCarriesTheWardrobeAndTheOutfit(t *testing.T) {
	h := setup(t)
	if _, err := h.store.Pool.Exec(t.Context(),
		"insert into wardrobe (user_id, item_id, source) values ($1, 'frame.steel', 'bought')", h.id("alice")); err != nil {
		t.Fatal(err)
	}
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into outfits (user_id, loadout) values ($1, '{"frame": "frame.steel"}')`, h.id("alice")); err != nil {
		t.Fatal(err)
	}
	files := h.exportFiles(t, "alice")
	var got struct {
		Owned []struct {
			Item string `json:"item"`
			How  string `json:"how"`
		} `json:"owned"`
		Outfit struct {
			Loadout map[string]string `json:"loadout"`
		} `json:"outfit"`
	}
	if err := json.Unmarshal([]byte(files["wardrobe.json"]), &got); err != nil {
		t.Fatalf("wardrobe.json: %v %q", err, files["wardrobe.json"])
	}
	if len(got.Owned) != 1 || got.Owned[0].Item != "frame.steel" || got.Owned[0].How != "bought" ||
		got.Outfit.Loadout["frame"] != "frame.steel" {
		t.Fatalf("wardrobe.json: %s", files["wardrobe.json"])
	}
	if bob := h.exportFiles(t, "bob")["wardrobe.json"]; strings.Contains(bob, "frame.steel") {
		t.Fatalf("bob's export carries alice's wardrobe: %s", bob)
	}
}
