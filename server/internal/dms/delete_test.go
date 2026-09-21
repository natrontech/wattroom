package dms

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// messages is one side's view of a conversation, with the pair-wide tombstone
// list the poll carries beside it.
func messages(t *testing.T, mux *http.ServeMux, who, peer string) ([]map[string]any, []any) {
	t.Helper()
	code, body := call(t, mux, who, http.MethodGet, "/api/dms/"+peer, "")
	if code != http.StatusOK {
		t.Fatalf("%s reading the thread: %d %v", who, code, body)
	}
	raw, _ := body["messages"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, m := range raw {
		line, _ := m.(map[string]any)
		out = append(out, line)
	}
	deleted, _ := body["deleted"].([]any)
	return out, deleted
}

// Taking back a direct message (#2418). It leaves a TOMBSTONE where a room
// line vanishes (#2417): the poll merges by id and can never say "gone", and
// a message silently disappearing from a two-person thread reads as "did I
// imagine that?".
func TestDeleteDmMessage(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)

	id := sendDm(t, mux, "alice", bob, "sent to the wrong person")

	// Each actor addresses the conversation by the OTHER person, so the peer
	// in the path differs per case.
	for _, c := range []struct {
		name, user, peer, path string
		want                   int
	}{
		{"signed out", "", bob, id, http.StatusUnauthorized},
		{"junk id", "alice", bob, "not-a-uuid", http.StatusNotFound},
		{"unknown message", "alice", bob, alice, http.StatusNotFound},
		// Bob is in this conversation and can see the line; it is simply not
		// his to take back. 403, not 404.
		{"not the sender", "bob", alice, id, http.StatusForbidden},
	} {
		t.Run(c.name, func(t *testing.T) {
			if code, body := call(t, mux, c.user, http.MethodDelete, "/api/dms/"+c.peer+"/messages/"+c.path, ""); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}

	// The sender's own. The row survives as a tombstone: the words are gone
	// from the database, and what is left is that something was here.
	code, body := call(t, mux, "alice", http.MethodDelete, "/api/dms/"+bob+"/messages/"+id, "")
	if code != http.StatusOK {
		t.Fatalf("alice deleting her own: %d %v", code, body)
	}
	if body["messageId"] != id {
		t.Fatalf("delete answered: %v", body)
	}

	// Both sides see the same thing, and BOB is the one who matters: his poll
	// merges by id and would otherwise keep showing the words forever.
	for _, who := range []string{"alice", "bob"} {
		peer := bob
		if who == "bob" {
			peer = alice
		}
		lines, deleted := messages(t, mux, who, peer)
		if len(lines) != 1 {
			t.Fatalf("%s sees %d lines, want 1", who, len(lines))
		}
		if lines[0]["text"] != "" {
			t.Fatalf("%s can still read the words: %v", who, lines[0])
		}
		if stamp, _ := lines[0]["deletedAt"].(float64); stamp <= 0 {
			t.Fatalf("%s got no tombstone stamp: %v", who, lines[0])
		}
		// The pair-wide list is what tells a reader already holding the line:
		// deleting does not move created_at, so `after` would never carry it.
		if len(deleted) != 1 || deleted[0] != id {
			t.Fatalf("%s's tombstone list: %v", who, deleted)
		}
	}

	// Deleting a tombstone is a 404, not a second stamp.
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/dms/"+bob+"/messages/"+id, ""); code != http.StatusNotFound {
		t.Fatalf("second delete should 404")
	}
}

// A conversation has no owner, so nobody may take back somebody else's words
// — not even out of their own copy of the thread.
func TestDeleteDmRefusesTheOtherSide(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)

	id := sendDm(t, mux, "alice", bob, "mine to keep")
	if code, body := call(t, mux, "bob", http.MethodDelete, "/api/dms/"+alice+"/messages/"+id, ""); code != http.StatusForbidden {
		t.Fatalf("bob deleting alice's: %d %v, want 403", code, body)
	}
	// A third party learns nothing: pair-scoped, so it is not even a 403.
	if code, body := call(t, mux, "cara", http.MethodDelete, "/api/dms/"+alice+"/messages/"+id, ""); code != http.StatusNotFound {
		t.Fatalf("cara deleting it: %d %v, want 404", code, body)
	}
	lines, deleted := messages(t, mux, "bob", alice)
	if len(lines) != 1 || lines[0]["text"] != "mine to keep" || len(deleted) != 0 {
		t.Fatalf("a refused delete changed the thread: %v %v", lines, deleted)
	}
}
