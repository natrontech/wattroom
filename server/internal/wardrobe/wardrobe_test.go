package wardrobe

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"
)

// client is the catalogue as the web app ships it.
type client struct {
	Schema   string `json:"schema"`
	Currency struct {
		Tiers map[string]int32 `json:"tiers"`
	} `json:"currency"`
	Guard struct {
		ItemKeys []string `json:"itemKeys"`
	} `json:"guard"`
	Slots []struct {
		ID string `json:"id"`
	} `json:"slots"`
	Items []map[string]any `json:"items"`
}

func readClient(t *testing.T) client {
	t.Helper()
	raw, err := os.ReadFile("../../../web/src/lib/wardrobe/catalogue.json")
	if err != nil {
		t.Fatal(err)
	}
	var c client
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func flag(m map[string]any, k string) bool  { b, _ := m[k].(bool); return b }

// The server's table and the client's file are one catalogue (#3153): the
// same schema, slots, tier prices and items, each with the same slot, price
// and unlock. An item the client sells that the server does not know could
// never be bought; one the server prices differently would be sold for the
// wrong sum.
func TestTheCatalogueIsInStepWithTheClient(t *testing.T) {
	c := readClient(t)
	if c.Schema != Schema {
		t.Fatalf("schema: the client is %q, the server %q", c.Schema, Schema)
	}
	if !reflect.DeepEqual(c.Currency.Tiers, tierPrices) {
		t.Errorf("tier prices: the client %v, the server %v", c.Currency.Tiers, tierPrices)
	}
	var clientSlots []string
	for _, s := range c.Slots {
		clientSlots = append(clientSlots, s.ID)
	}
	if !slices.Equal(clientSlots, slots) {
		t.Errorf("slots: the client %v, the server %v", clientSlots, slots)
	}
	if len(c.Items) != len(items) {
		t.Errorf("the client has %d items, the server %d", len(c.Items), len(items))
	}
	for _, ci := range c.Items {
		id := str(ci, "id")
		want := Item{
			ID: id, Slot: str(ci, "slot"), Tier: str(ci, "tier"), Unlock: str(ci, "unlock"),
			Starter: flag(ci, "starter"), Free: flag(ci, "free"), CrewOnly: flag(ci, "crewOnly"),
		}
		got, ok := Lookup(id)
		if !ok {
			t.Errorf("%s: in the client, not on the server", id)
			continue
		}
		if got != want {
			t.Errorf("%s: the server holds %+v, the client %+v", id, got, want)
		}
		if !slices.Contains(slots, got.Slot) {
			t.Errorf("%s: slot %q is no slot", id, got.Slot)
		}
	}
}

// forbidden is every word a stat would be spelled with (ADR-0069: no item
// has a stat). Held here rather than read from the catalogue's own guard, so
// loosening the guard in the data cannot loosen this test.
var forbidden = []string{
	"weight", "mass", "kg", "aero", "cda", "drag", "crr", "rolling", "watts",
	"power", "speed", "stiffness", "efficiency", "bonus", "boost", "multiplier",
	"xp", "grip", "fast",
}

// An item is a look, never a stat (#3153, ADR-0069): the server's Item has
// exactly the fields a look needs, and no client item carries a key — nor
// does the catalogue's own allowlist name one — that a stat would use.
func TestAnItemCarriesNoStat(t *testing.T) {
	allowed := []string{"ID", "Slot", "Tier", "Unlock", "Starter", "Free", "CrewOnly"}
	for f := range reflect.TypeFor[Item]().Fields() {
		if !slices.Contains(allowed, f.Name) {
			t.Errorf("Item has a field %q: an item is a look, and a new field on it is a decision (ADR-0069), not a line of code", f.Name)
		}
	}
	c := readClient(t)
	for _, key := range c.Guard.ItemKeys {
		if slices.Contains(forbidden, key) {
			t.Errorf("the catalogue's allowlist admits %q", key)
		}
	}
	for _, it := range c.Items {
		for key := range it {
			if slices.Contains(forbidden, key) {
				t.Errorf("%s carries %q", str(it, "id"), key)
			}
			if !slices.Contains(c.Guard.ItemKeys, key) {
				t.Errorf("%s carries %q, which the catalogue's allowlist does not name", str(it, "id"), key)
			}
		}
	}
}

// docs/SPEC.md "Wardrobe": 39 slots; 122 items to buy, 29,860 Batzen in all;
// 33 earned, never sold.
func TestTheCatalogueIsTheOneSPECDescribes(t *testing.T) {
	counts := map[string]int{}
	var total int32
	for _, it := range items {
		counts[it.Kind()]++
		total += it.Price()
	}
	if len(slots) != 39 || counts["buy"] != 122 || counts["earn"] != 33 || total != 29_860 {
		t.Fatalf("%d slots, %d to buy for %d Batzen, %d earned; SPEC says 39, 122 for 29,860, 33",
			len(slots), counts["buy"], total, counts["earn"])
	}
}
