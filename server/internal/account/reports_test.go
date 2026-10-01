package account

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/feedback"
	"github.com/natrontech/wattroom/server/internal/store"
)

// A rider's flag reports go with their account (#2906): each row keeps their
// name, their last two minutes and their own log lines, in a file no cascade
// reaches, and WATTROOM.md promises a full purge. Bob's stay.
func TestDeleteTakesTheRidersFlagReportsOffDisk(t *testing.T) {
	h := setup(t)
	dir := t.TempDir()
	t.Setenv("WATTROOM_FEEDBACK_DIR", dir)
	h.svc.SetReportReaper(feedback.New(h.users, nil, nil, feedback.NewLogRing(slog.DiscardHandler), slog.New(slog.DiscardHandler)))
	path := filepath.Join(dir, "reports.jsonl")
	rows := `{"reporter":"alice","reporterId":"` + store.UUIDString(h.id("alice")) + `","report":{"note":"erg felt off"}}
{"reporter":"bob","reporterId":"` + store.UUIDString(h.id("bob")) + `","report":{"note":"bobs flag"}}
`
	if err := os.WriteFile(path, []byte(rows), 0o600); err != nil {
		t.Fatal(err)
	}

	if rec := h.call(t, "alice", http.MethodDelete, "/api/me"); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	raw, err := os.ReadFile(path) //nolint:gosec // t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "erg felt off") {
		t.Errorf("alice's report outlived her account:\n%s", raw)
	}
	if !strings.Contains(string(raw), "bobs flag") {
		t.Errorf("bob's report went with alice's account:\n%s", raw)
	}
}
