package dms

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// sendDm posts one line and hands back its id.
func sendDm(t *testing.T, mux *http.ServeMux, from, to, text string) string {
	t.Helper()
	code, body := call(t, mux, from, http.MethodPost, "/api/dms/"+to, `{"text":"`+text+`"}`)
	if code != http.StatusOK {
		t.Fatalf("send: %d %v", code, body)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("no id back: %v", body)
	}
	return id
}

func TestEditDmMessage(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.byToken["alice"].ID)
	bob := store.UUIDString(users.byToken["bob"].ID)
	cara := store.UUIDString(users.byToken["cara"].ID)
	id := sendDm(t, mux, "alice", bob, "ride at 6?")

	cases := []struct {
		name  string
		user  string
		peer  string
		msgID string
		body  string
		want  int
	}{
		{"signed out", "", bob, id, `{"text":"7"}`, http.StatusUnauthorized},
		{"not the sender", "bob", alice, id, `{"text":"mine now"}`, http.StatusForbidden},
		{"a stranger's guess", "cara", alice, id, `{"text":"mine now"}`, http.StatusNotFound},
		{"wrong conversation", "alice", cara, id, `{"text":"7"}`, http.StatusNotFound},
		{"junk id", "alice", bob, "not-a-uuid", `{"text":"7"}`, http.StatusNotFound},
		{"too long", "alice", bob, id, `{"text":"` + strings.Repeat("x", 501) + `"}`, http.StatusBadRequest},
		{"edited to nothing", "alice", bob, id, `{"text":"  "}`, http.StatusBadRequest},
		{"unknown field", "alice", bob, id, `{"text":"7","mine":true}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, body := call(t, mux, c.user, http.MethodPatch, "/api/dms/"+c.peer+"/messages/"+c.msgID, c.body)
			if code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}

	// Happy: the sender rewrites it, and the peer reads the new words.
	code, body := call(t, mux, "alice", http.MethodPatch, "/api/dms/"+bob+"/messages/"+id, `{"text":"  ride at 7?  "}`)
	if code != http.StatusOK || body["text"] != "ride at 7?" {
		t.Fatalf("edit: %d %v", code, body)
	}
	stamp, _ := body["editedAt"].(float64)
	if stamp <= 0 {
		t.Fatalf("no edit stamp: %v", body)
	}
	code, body = call(t, mux, "bob", http.MethodGet, "/api/dms/"+alice, "")
	msgs, _ := body["messages"].([]any)
	if code != http.StatusOK || len(msgs) != 1 {
		t.Fatalf("thread: %d %v", code, body)
	}
	first, _ := msgs[0].(map[string]any)
	if first["text"] != "ride at 7?" {
		t.Fatalf("peer still reads the old words: %v", first)
	}
	if edited, _ := first["editedAt"].(float64); edited != stamp {
		t.Fatalf("thread stamp %v, want %v", first["editedAt"], stamp)
	}
}

// The peer polls with `after`, and an edit does not move created_at — so the
// edits map, not the message page, is what carries a rewrite to a line the
// reader already has. This is the regression the incremental fetch invites.
func TestEditReachesAPeerPollingForNewerMessages(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.byToken["alice"].ID)
	bob := store.UUIDString(users.byToken["bob"].ID)
	id := sendDm(t, mux, "alice", bob, "ride at 6?")

	code, body := call(t, mux, "bob", http.MethodGet, "/api/dms/"+alice, "")
	msgs, _ := body["messages"].([]any)
	if code != http.StatusOK || len(msgs) != 1 {
		t.Fatalf("first read: %d %v", code, body)
	}
	first, _ := msgs[0].(map[string]any)
	at, _ := first["at"].(float64)

	if code, body := call(t, mux, "alice", http.MethodPatch, "/api/dms/"+bob+"/messages/"+id, `{"text":"ride at 7?"}`); code != http.StatusOK {
		t.Fatalf("edit: %d %v", code, body)
	}

	// Bob's next poll asks only for what is newer than the line he has.
	code, body = call(t, mux, "bob", http.MethodGet, "/api/dms/"+alice+"?after="+strconv.FormatInt(int64(at), 10), "")
	if code != http.StatusOK {
		t.Fatalf("poll: %d %v", code, body)
	}
	edits, _ := body["edits"].(map[string]any)
	edit, _ := edits[id].(map[string]any)
	if edit == nil || edit["text"] != "ride at 7?" {
		t.Fatalf("the edit never reached the poll: %v", body["edits"])
	}
	if stamp, _ := edit["editedAt"].(float64); stamp <= 0 {
		t.Fatalf("edit carries no stamp: %v", edit)
	}
}
