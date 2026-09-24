package dms

import (
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

type heardPokes struct {
	mu  sync.Mutex
	ids []string
	got []protocol.Poke
}

func (h *heardPokes) PokeRider(riderID string, poke protocol.Poke) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ids = append(h.ids, riderID)
	h.got = append(h.got, poke)
}

// A friend's poke is a line in the thread (#2721): who and when for the
// record, the words if any, and the live tap handed to the hub with the
// line's own time — the one both announcement paths dedupe on.
func TestPokeIsALineInTheThread(t *testing.T) {
	live := &heardPokes{}
	mux, _, users := setupLive(t, live)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)

	status, body := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob+"/poke", `{"text":"  wheel!  "}`)
	if status != http.StatusOK {
		t.Fatalf("poke a friend: %d %v", status, body)
	}
	atMs, _ := body["at"].(float64)
	at := int64(atMs)

	want := protocol.Poke{To: bob, FromID: alice, From: "alice", At: at, Text: "wheel!", Dm: true}
	if len(live.got) != 1 || live.got[0] != want || live.ids[0] != bob {
		t.Fatalf("the hub heard %v %+v, want %+v", live.ids, live.got, want)
	}

	_, thread := call(t, mux, "bob", http.MethodGet, "/api/dms/"+alice, "")
	lines, _ := thread["messages"].([]any)
	if len(lines) == 0 {
		t.Fatalf("bob's thread is empty: %v", thread)
	}
	line, _ := lines[len(lines)-1].(map[string]any)
	if line["poke"] != true || line["text"] != "wheel!" || line["mine"] != false {
		t.Fatalf("bob's thread line: %v", line)
	}
	_, heads := call(t, mux, "bob", http.MethodGet, "/api/dms", "")
	conversations, _ := heads["conversations"].([]any)
	if len(conversations) == 0 {
		t.Fatalf("bob has no conversations: %v", heads)
	}
	head, _ := conversations[0].(map[string]any)
	if head["poke"] != true || head["at"] != atMs {
		t.Fatalf("bob's head: %v", head)
	}
}

func TestPokeRefusals(t *testing.T) {
	mux, _, users := setupLive(t, &heardPokes{})
	bob := store.UUIDString(users.ByToken["bob"].ID)
	cara := store.UUIDString(users.ByToken["cara"].ID)

	if status, body := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob+"/poke", `{}`); status != http.StatusOK {
		t.Fatalf("a bare poke: %d %v", status, body)
	}
	for _, tc := range []struct {
		name, user, peer, body string
		status                 int
		code                   string
	}{
		{"again inside the cooldown", "alice", bob, `{}`, http.StatusTooManyRequests, "rate_limited"},
		{"a stranger", "alice", cara, `{}`, http.StatusForbidden, "forbidden"},
		{"too many words", "bob", "", `{"text":"` + strings.Repeat("x", protocol.MaxMessageChars+1) + `"}`, http.StatusBadRequest, "validation_error"},
		{"not a person", "alice", "nobody", `{}`, http.StatusBadRequest, "invalid_request"},
		{"signed out", "", bob, `{}`, http.StatusUnauthorized, "unauthorized"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			peer := tc.peer
			if peer == "" {
				peer = store.UUIDString(users.ByToken["alice"].ID)
			}
			status, body := call(t, mux, tc.user, http.MethodPost, "/api/dms/"+peer+"/poke", tc.body)
			if status != tc.status || body["error"] != tc.code {
				t.Fatalf("%d %v, want %d %s", status, body, tc.status, tc.code)
			}
		})
	}
}
