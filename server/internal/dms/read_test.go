package dms

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// headUnread is the dot on who's conversation with peer, as the heads say.
func headUnread(t *testing.T, mux *http.ServeMux, who, peer string) bool {
	t.Helper()
	code, body := call(t, mux, who, http.MethodGet, "/api/dms", "")
	if code != http.StatusOK {
		t.Fatalf("heads: %d %v", code, body)
	}
	heads, _ := body["conversations"].([]any)
	for _, raw := range heads {
		if head, _ := raw.(map[string]any); head["peerId"] == peer {
			return head["unread"] == true
		}
	}
	t.Fatalf("%s has no conversation with %s", who, peer)
	return false
}

// A read covers what the reader was shown and nothing after it (#2750). The
// thread posts the newest line it has; a line that landed between that fetch
// and the read stays unread, and a device with an older view cannot un-read
// what another already read.
func TestDmReadCoversOnlyTheLinesTheReaderWasShown(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)
	send := func(text string) string {
		t.Helper()
		code, body := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"`+text+`"}`)
		id, _ := body["id"].(string)
		if code != http.StatusOK || id == "" {
			t.Fatalf("send: %d %v", code, body)
		}
		return id
	}
	read := func(body string, want int) {
		t.Helper()
		if code, got := call(t, mux, "bob", http.MethodPost, "/api/dms/"+alice+"/read", body); code != want {
			t.Fatalf("read %s: %d %v, want %d", body, code, got, want)
		}
	}
	upTo := func(id string) string { return `{"upTo":"` + id + `"}` }

	shown := send("warm-up at 7?")
	send("make it 7:30") // lands after bob's thread fetched, before it reads
	read(upTo(shown), http.StatusNoContent)
	if !headUnread(t, mux, "bob", alice) {
		t.Fatal("a line bob was never shown counts as read")
	}
	read(upTo("00000000-0000-0000-0000-000000000000"), http.StatusNoContent)
	if !headUnread(t, mux, "bob", alice) {
		t.Fatal("a read naming no line of this pair moved the cursor")
	}
	read(upTo("nope"), http.StatusBadRequest)

	read("", http.StatusNoContent) // a tab on the old script: the newest line
	if headUnread(t, mux, "bob", alice) {
		t.Fatal("a read without upTo left the newest line unread")
	}
	read(upTo(shown), http.StatusNoContent) // the phone, a poll behind
	if headUnread(t, mux, "bob", alice) {
		t.Fatal("an older device's read moved the cursor back")
	}
}

// The read cursor lives on the server (#2711), so reading on one device
// clears the dot on the others — and it stays the reader's own: the peer's
// answers never change because of it (ADR-0012 amended 2026-09-24).
func TestDmReadIsTheReadersOwnOnEveryDevice(t *testing.T) {
	mux, st, users := setup(t)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)
	send := func(from, to, text string) {
		t.Helper()
		if code, body := call(t, mux, from, http.MethodPost, "/api/dms/"+to, `{"text":"`+text+`"}`); code != http.StatusCreated && code != http.StatusOK {
			t.Fatalf("send: %d %v", code, body)
		}
	}
	unread := func(who, peer string) bool {
		t.Helper()
		return headUnread(t, mux, who, peer)
	}
	readAt := func(who, peer string) float64 {
		t.Helper()
		_, body := call(t, mux, who, http.MethodGet, "/api/dms/"+peer, "")
		at, ok := body["readAt"].(float64)
		if !ok {
			t.Fatalf("thread without readAt: %v", body)
		}
		return at
	}
	read := func(who, peer string) {
		t.Helper()
		if code, body := call(t, mux, who, http.MethodPost, "/api/dms/"+peer+"/read", ""); code != http.StatusNoContent {
			t.Fatalf("read: %d %v", code, body)
		}
	}

	send("alice", bob, "hey")
	if !unread("bob", alice) || readAt("bob", alice) != 0 {
		t.Fatal("a line bob never read must be unread, with no cursor")
	}
	if unread("alice", bob) {
		t.Fatal("alice's own line is not unread to her")
	}

	read("bob", alice)
	if unread("bob", alice) || readAt("bob", alice) == 0 {
		t.Fatal("after bob reads, every device of his must see it read")
	}
	if readAt("alice", bob) != 0 {
		t.Fatal("bob's read reached alice — that is a read receipt")
	}

	// My reply on top must not hide their line beneath it.
	send("alice", bob, "again")
	send("bob", alice, "reply")
	if !unread("bob", alice) {
		t.Fatal("alice's second line is unread even with bob's reply on top")
	}

	for _, c := range []struct {
		name, user, peer string
		want             int
	}{
		{"signed out", "", alice, http.StatusUnauthorized},
		{"yourself", "bob", bob, http.StatusBadRequest},
		{"not an id", "bob", "nope", http.StatusBadRequest},
	} {
		t.Run(c.name, func(t *testing.T) {
			if code, body := call(t, mux, c.user, http.MethodPost, "/api/dms/"+c.peer+"/read", ""); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}

	// No conversation, no row: a read of a stranger is a no-op.
	read("cara", bob)
	_, err := st.Queries.GetDmReadAt(t.Context(), db.GetDmReadAtParams{
		UserID: users.ByToken["cara"].ID, PeerID: users.ByToken["bob"].ID,
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("cara's read of a thread she never had left a row: %v", err)
	}
}
