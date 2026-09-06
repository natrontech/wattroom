package store

import (
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
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

// Sequence numbers were only ever correct at the instant a branch merged, and
// nothing can check them at that instant (#928): two branches each take the
// next free number, each is green alone, and main does not boot once both
// land. New migrations are named for the moment they were written instead —
// `scripts/new-migration.sh <slug>`, or `make migration name=<slug>`.
//
// The files below this ceiling are the ones that already existed; nothing is
// renamed, because goose sorts numerically and every timestamp sorts after
// every one of them, forever.
const lastSequentialVersion = 39

func TestNewMigrationsAreTimestamped(t *testing.T) {
	entries, err := os.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		version, _, _ := strings.Cut(name, "_")
		n, err := strconv.ParseInt(version, 10, 64)
		if err != nil {
			t.Errorf("%s: goose wants a numeric version before the first underscore", name)
			continue
		}
		if n <= lastSequentialVersion {
			continue // one of the originals
		}
		// A UTC yyyymmddhhmmss, which is 14 digits and therefore enormous
		// beside any sequence number anyone would type.
		if _, err := time.Parse("20060102150405", version); err != nil {
			t.Errorf("%s takes the next sequence number, which two branches can take at once — "+
				"run `make migration name=<slug>` and move the body into the file it prints", name)
		}
	}
}
