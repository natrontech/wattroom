package gamify

import (
	"testing"
)

func TestCatalogueKeysAreUnique(t *testing.T) {
	seen := make(map[string]bool, len(Catalogue))
	for _, a := range Catalogue {
		if seen[a.Key] {
			t.Errorf("duplicate key %q", a.Key)
		}
		seen[a.Key] = true
		if a.XP != XpEasy && a.XP != XpMedium && a.XP != XpHard {
			t.Errorf("%s pays %d, not a SPEC tier", a.Key, a.XP)
		}
	}
}
