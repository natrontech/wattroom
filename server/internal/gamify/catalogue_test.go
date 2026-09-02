package gamify

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The client draws the catalogue from its own copy of this table. One file
// per side, one test that they agree — by key, icon and XP, in order — so
// a new achievement added on one side fails here, not in a rider's shelf.
func TestCatalogueMatchesTheClient(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "src", "lib", "trophies", "catalogue.ts"))
	if err != nil {
		t.Fatalf("client catalogue: %v", err)
	}
	// Each entry is one object literal: capture its key, icon and xp.
	entry := regexp.MustCompile(`(?s)\{\s*key: '([^']+)',.*?icon: (\w+),.*?xp: (\d+),`)
	matches := entry.FindAllStringSubmatch(string(src), -1)
	if len(matches) != len(Catalogue) {
		t.Fatalf("client has %d achievements, server %d", len(matches), len(Catalogue))
	}
	for i, m := range matches {
		want := Catalogue[i]
		if m[1] != want.Key {
			t.Errorf("entry %d: client key %q, server %q", i, m[1], want.Key)
		}
		if icon := lucideName(m[2]); icon != want.Icon {
			t.Errorf("%s: client icon %q, server %q", want.Key, icon, want.Icon)
		}
		if xp, _ := strconv.Atoi(m[3]); xp != want.XP {
			t.Errorf("%s: client xp %d, server %d", want.Key, xp, want.XP)
		}
	}
}

// lucideName turns a component import (Headphones, BicepsFlexed) into the
// kebab-case name the server table carries.
func lucideName(component string) string {
	var b strings.Builder
	for i, r := range component {
		if i > 0 && r >= 'A' && r <= 'Z' {
			b.WriteByte('-')
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

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
