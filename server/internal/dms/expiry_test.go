package dms

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// A temporary DM (#2644): the same three timers as a channel, the line says
// when it runs out, and once it has the thread no longer serves it — no
// tombstone, because nothing was taken back.
func TestTemporaryDms(t *testing.T) {
	mux, st, users := setup(t)
	alice, bob := users.ByToken["alice"], users.ByToken["bob"]
	path := "/api/dms/" + store.UUIDString(bob.ID)

	if code, got := call(t, mux, "alice", http.MethodPost, path, `{"text":"hi","expiresIn":60}`); code != http.StatusBadRequest || got["field"] != "expiresIn" {
		t.Fatalf("a minute's timer: %d %v, want 400 on expiresIn", code, got)
	}
	code, got := call(t, mux, "alice", http.MethodPost, path, `{"text":"for a day","expiresIn":86400}`)
	at, _ := got["at"].(float64)
	expires, _ := got["expiresAt"].(float64)
	// The answer's `at` is the row's clock, the timer the handler's: allow
	// the moment between them.
	if code != http.StatusOK || expires-at < 86_399_000 || expires-at > 86_401_000 {
		t.Fatalf("send: %d %v", code, got)
	}
	id, _ := got["id"].(string)

	if _, err := st.Pool.Exec(t.Context(),
		"update dm_messages set expires_at = now() - interval '1 second' where id = $1", id); err != nil {
		t.Fatal(err)
	}
	_, thread := call(t, mux, "bob", http.MethodGet, "/api/dms/"+store.UUIDString(alice.ID), "")
	if msgs, _ := thread["messages"].([]any); len(msgs) != 0 {
		t.Fatalf("a run-out line is still served: %v", msgs)
	}
	if n, err := st.Queries.DeleteExpiredDms(t.Context()); err != nil || n != 1 {
		t.Fatalf("sweep: %d %v", n, err)
	}
}
