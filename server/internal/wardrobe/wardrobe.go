// Package wardrobe is what a rider can own and wear (#3153, ADR-0069,
// ADR-0073): the catalogue's items as the server needs them — an id, a slot,
// a price or an unlock — and the rider's wardrobe and outfit. Looks only:
// nothing here enters the physics, a bunch's offsets or a result, and the
// Item type below has no field that could.
package wardrobe

import "strings"

// Item is one catalogue entry as the server holds it. Its fields are
// whitelisted (TestAnItemCarriesNoStat): an aero, weight or speed field fails
// a test, because an item is a look and never a stat (ADR-0069).
type Item struct {
	ID   string
	Slot string
	// A price tier (docs/SPEC.md "Wardrobe"), set only on an item sold for
	// Batzen.
	Tier string
	// "earned:<rule>" or "with:<frame>|<frame>", on an item never sold.
	Unlock string
	// In every garage from day one, or free for anyone to pick.
	Starter, Free bool
	// A crew's own kit: its members wear it free.
	CrewOnly bool
}

// Kind is how an item is had — the client's kindOf, the one reading.
func (i Item) Kind() string {
	switch {
	case i.Tier != "":
		return "buy"
	case strings.HasPrefix(i.Unlock, "earned:"):
		return "earn"
	case strings.HasPrefix(i.Unlock, "with:"):
		return "with"
	case i.CrewOnly:
		return "crew"
	}
	return "free"
}

// Price is what the item costs in Batzen; 0 for an item never sold.
func (i Item) Price() int32 { return tierPrices[i.Tier] }

var byID = func() map[string]Item {
	m := make(map[string]Item, len(items))
	for _, it := range items {
		m[it.ID] = it
	}
	return m
}()

// Lookup is the catalogue's item by id, and whether there is one.
func Lookup(id string) (Item, bool) {
	it, ok := byID[id]
	return it, ok
}
