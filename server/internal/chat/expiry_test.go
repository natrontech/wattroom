package chat

import (
	"net/http"
	"testing"
)

// A temporary line (#2644): the timer is one of three, the line carries when
// it runs out, and once it has it is gone to every reader at once — not at
// the next sweep — and nothing can be done to it any more.
func TestTemporaryChannelLines(t *testing.T) {
	w := channelSetup(t)
	path := "/api/channels/" + w.open + "/chat"

	for _, body := range []string{`{"text":"hi","expiresIn":5}`, `{"text":"hi","expiresIn":-3600}`} {
		if code, got := post(t, w.mux, "alice", path, body); code != http.StatusBadRequest || got["field"] != "expiresIn" {
			t.Fatalf("%s: %d %v, want 400 on expiresIn", body, code, got)
		}
	}

	code, got := post(t, w.mux, "alice", path, `{"text":"gone in an hour","expiresIn":3600}`)
	if code != http.StatusOK {
		t.Fatalf("post: %d %v", code, got)
	}
	id, _ := got["id"].(string)
	at, _ := got["at"].(float64)
	if expires, _ := got["expiresAt"].(float64); expires-at != 3600_000 {
		t.Fatalf("expiresAt %v is not an hour after %v", got["expiresAt"], at)
	}
	w.say(t, "bob", w.open, "this one stays")
	for _, m := range w.messages(t, "bob", w.open) {
		_, timed := m["expiresAt"]
		if timed != (m["id"] == id) {
			t.Fatalf("line %v: expiresAt present = %v", m["text"], timed)
		}
	}

	// The clock runs out; nothing has swept yet.
	if _, err := w.svc.store.Pool.Exec(t.Context(),
		"update chat_messages set expires_at = now() - interval '1 second' where id = $1", id); err != nil {
		t.Fatal(err)
	}
	if lines := w.lines(t, "bob", w.open); len(lines) != 1 || lines[0] != "this one stays" {
		t.Fatalf("after the timer: %v", lines)
	}
	if code, _ := del(t, w.mux, "alice", path+"/"+id); code != http.StatusNotFound {
		t.Fatalf("deleting a run-out line: %d, want 404", code)
	}

	// And the sweep takes it out of the table.
	if _, err := w.svc.store.Queries.DeleteExpiredChat(t.Context()); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := w.svc.store.Pool.QueryRow(t.Context(),
		"select count(*) from chat_messages where id = $1", id).Scan(&left); err != nil || left != 0 {
		t.Fatalf("swept line still in the table: %d %v", left, err)
	}
}
