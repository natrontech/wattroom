package feedback

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A deleted account's flag reports leave reports.jsonl with it (#2906), and
// nothing else does: another rider's, one from before #2822 that names nobody
// by id, and a line that does not parse all stay.
func TestRemoveReporterTakesOnlyThatRidersReports(t *testing.T) {
	svc := &Service{dir: t.TempDir(), log: slog.New(slog.DiscardHandler)}
	// Nothing on disk yet is nothing to do.
	svc.RemoveReporter("alice-id")

	for _, row := range []map[string]any{
		{"reporter": "Alice", "reporterId": "alice-id", "report": map[string]any{"note": "alice one"}},
		{"reporter": "Bob", "reporterId": "bob-id", "report": map[string]any{"note": "bob one"}},
		{"reporter": "Alice", "report": map[string]any{"note": "before the id"}},
		{"reporter": "Alice", "reporterId": "alice-id", "report": map[string]any{"note": "alice two"}},
	} {
		if err := svc.append(row); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(svc.dir, "reports.jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0) //nolint:gosec // t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("not json at all\n"); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	svc.RemoveReporter("alice-id")

	text := rawReports(t, path)
	for _, gone := range []string{"alice one", "alice two"} {
		if strings.Contains(text, gone) {
			t.Errorf("%q is still on disk after alice's account went:\n%s", gone, text)
		}
	}
	for _, kept := range []string{"bob one", "before the id", "not json at all"} {
		if !strings.Contains(text, kept) {
			t.Errorf("%q went with alice's reports:\n%s", kept, text)
		}
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("the rewritten file is %v (%v), want 0600 like the one it replaced", info.Mode().Perm(), err)
	}
	if leftovers, _ := filepath.Glob(filepath.Join(svc.dir, "reports-*")); len(leftovers) != 0 {
		t.Errorf("the rewrite left temp files behind: %v", leftovers)
	}

	// The file still takes reports afterwards.
	if err := svc.append(map[string]any{"reporterId": "bob-id", "report": map[string]any{"note": "bob two"}}); err != nil {
		t.Fatal(err)
	}
	if text := rawReports(t, path); !strings.Contains(text, "bob two") || !strings.Contains(text, "bob one") {
		t.Errorf("an append after the purge lost a row:\n%s", text)
	}
}

// rawReports is the file as it lies on disk, the unparsable line included.
func rawReports(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path) //nolint:gosec // t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
