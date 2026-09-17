package auth

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ADR-0030 sells enumerability as its whole value: "one place to read to
// answer 'do we mail on this?'". The list drifted — it claimed six call sites
// and said nothing about address removal (#1638), which had been an alarm for
// months (#2258). A list nobody checks is the failure that ADR was written
// against, so this counts the call sites for it.
//
// Reading source is unusual for a test and is the point: the invariant is
// about the SET of call sites, which nothing at runtime can see.
func TestEveryAlarmIsOnTheADRsList(t *testing.T) {
	// The auth package's own alarms. The eighth, notify.AccountDeleted's
	// receipt for a purge, is not one of these and is named separately on the
	// ADR's list.
	const want = 7

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]int{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		body, err := os.ReadFile(filepath.Clean(name))
		if err != nil {
			t.Fatal(err)
		}
		// alerts.go holds the helper's own definition, not a trigger.
		if n := strings.Count(string(body), "s.alert("); n > 0 && name != "alerts.go" {
			found[name] = n
		}
	}
	total := 0
	for _, n := range found {
		total += n
	}
	if total != want {
		t.Errorf("the auth package has %d security-alarm call sites %v, and ADR-0030 lists %d.\n"+
			"Whichever moved, move the other: the ADR's value is that the set is enumerable.", total, found, want)
	}
}
