package store

import (
	"os"
	"strings"
	"testing"
)

// Two migrations numbered the same is not a merge conflict anyone sees: both
// files exist, both PRs were green on their own branch, and goose panics at
// collect time — before it runs anything — so the SERVER DOES NOT BOOT. Main
// spent an evening in that state (00036 twice, #869 and #923) and the symptom
// was a stack trace in every test that touches a database.
//
// One test, so the next collision is a red line naming both files instead.
func TestMigrationVersionsAreUnique(t *testing.T) {
	entries, err := os.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		version, _, ok := strings.Cut(name, "_")
		if !ok {
			t.Errorf("%s: goose wants <version>_<name>.sql", name)
			continue
		}
		if first, dup := seen[version]; dup {
			t.Errorf("version %s used twice: %s and %s — renumber the one that merged second", version, first, name)
			continue
		}
		seen[version] = name
	}
}
