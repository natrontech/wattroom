package dms

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// Every write in a conversation pings both of its riders' lobby sockets, so
// their lists follow the ping instead of a 10 s poll (#2937); a read pings the
// reader alone — the peer hearing it would be a read receipt (ADR-0012).
func TestAConversationPingsBothSidesAndAReadOnlyTheReader(t *testing.T) {
	live := &heardPokes{}
	mux, _, users := setupLive(t, live)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)
	pair := [2]string{alice, bob}

	_, sent := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"ride at 7?"}`)
	line, _ := sent["id"].(string)
	for _, step := range []struct{ name, method, path, body string }{
		{"send", "", "", ""},
		{"edit", http.MethodPatch, "/api/dms/" + bob + "/messages/" + line, `{"text":"ride at 8?"}`},
		{"react", http.MethodPost, "/api/dms/" + bob + "/reactions", `{"messageId":"` + line + `","emoji":"flame"}`},
		{"poke", http.MethodPost, "/api/dms/" + bob + "/poke", `{}`},
		{"delete", http.MethodDelete, "/api/dms/" + bob + "/messages/" + line, ""},
	} {
		if step.method != "" {
			if code, body := call(t, mux, "alice", step.method, step.path, step.body); code != http.StatusOK {
				t.Fatalf("%s: %d %v", step.name, code, body)
			}
		}
		if n := len(live.pairs); n == 0 || live.pairs[n-1] != pair {
			t.Fatalf("%s pinged %v, want both sides %v last", step.name, live.pairs, pair)
		}
		live.pairs = nil
	}

	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/dms/"+alice+"/read", ""); code != http.StatusNoContent {
		t.Fatalf("read: %d", code)
	}
	if len(live.reads) != 1 || live.reads[0] != bob || len(live.pairs) != 0 {
		t.Fatalf("a read pinged reads %v and pairs %v; want bob's own devices alone", live.reads, live.pairs)
	}

	// A refused send is no change: a stranger's attempt pings nobody.
	cara := store.UUIDString(users.ByToken["cara"].ID)
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+cara, `{"text":"hi"}`); code != http.StatusForbidden {
		t.Fatalf("stranger: %d", code)
	}
	if len(live.pairs) != 0 {
		t.Fatalf("a refused send pinged %v", live.pairs)
	}
}
