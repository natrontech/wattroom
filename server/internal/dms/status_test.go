package dms

import (
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A conversation carries the friend's status line (ADR-0060), and stops
// carrying it once it has cleared.
func TestDmHeadsCarryThePeersStatusLine(t *testing.T) {
	mux, st, users := setup(t)
	bob := store.UUIDString(users.ByToken["bob"].ID)
	if code, body := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"ride at 7?"}`); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("send: %d %v", code, body)
	}
	lineOf := func() any {
		code, body := call(t, mux, "alice", http.MethodGet, "/api/dms", "")
		if code != http.StatusOK {
			t.Fatalf("heads: %d %v", code, body)
		}
		heads, _ := body["conversations"].([]any)
		if len(heads) != 1 {
			t.Fatalf("heads = %v, want the one with bob", heads)
		}
		head, _ := heads[0].(map[string]any)
		return head["peerStatusLine"]
	}
	if line := lineOf(); line != nil {
		t.Fatalf("bob has no status, the head says %v", line)
	}

	text := "Out sick"
	if err := st.Queries.SetUserStatus(t.Context(), db.SetUserStatusParams{
		ID: users.ByToken["bob"].ID, Text: &text,
	}); err != nil {
		t.Fatalf("status: %v", err)
	}
	if line, _ := lineOf().(map[string]any); line["text"] != text {
		t.Fatalf("head carries %v, want %q", lineOf(), text)
	}

	if err := st.Queries.SetUserStatus(t.Context(), db.SetUserStatusParams{
		ID: users.ByToken["bob"].ID, Text: &text,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatalf("status: %v", err)
	}
	if line := lineOf(); line != nil {
		t.Fatalf("a cleared status still reads %v", line)
	}
}
