package auth

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ADR-0030 sells the alarm's trigger list on being enumerable: "one body, one
// place to read to answer 'do we mail on this?'". That only holds while the
// list and the code agree, and it had already drifted — address *removal*
// (#1638) alarms and was on neither the list nor the count (#2258).
//
// So the count in the ADR is checked against the call sites. A new trigger is
// a normal change; adding one without the ADR is what this refuses.
func TestTheAlarmTriggerListMatchesTheCallSites(t *testing.T) {
	// The alarm's own body in notify lives at the far end of the same call
	// (`SecurityAlert`) and the purge receipt is one of the triggers, so both
	// packages count.
	sites := 0
	call := regexp.MustCompile(`\.alert\(`)
	for _, dir := range []string{filepath.Join("..", "auth"), filepath.Join("..", "notify")} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("read %s: %v", dir, err)
		}
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			src, err := os.ReadFile(filepath.Join(dir, name)) //nolint:gosec // two fixed package directories, walked to count call sites
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			sites += len(call.FindAll(src, -1))
		}
	}
	// One of the matches in notify is the shared body every trigger routes
	// through, not a trigger of its own.
	triggers := sites - 1

	adr, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "decisions", "0030-what-wattroom-emails.md"))
	if err != nil {
		t.Fatalf("read ADR-0030: %v", err)
	}
	counted := regexp.MustCompile(`(?m)^(\w+) call sites, one body`).FindSubmatch(adr)
	if counted == nil {
		t.Fatal("ADR-0030 no longer states its call-site count in the form '<N> call sites, one body'")
	}
	words := map[string]int{"Four": 4, "Five": 5, "Six": 6, "Seven": 7, "Eight": 8, "Nine": 9, "Ten": 10}
	want, ok := words[string(counted[1])]
	if !ok {
		t.Fatalf("ADR-0030 says %q call sites, which is not a number this test knows", counted[1])
	}
	if triggers != want {
		t.Errorf("%d alarm triggers in the code, ADR-0030 enumerates %d — add the trigger to the list in docs/decisions/0030-what-wattroom-emails.md in the same change", triggers, want)
	}
}
