package blocks_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/blocks"
	"github.com/natrontech/wattroom/server/internal/dms"
	"github.com/natrontech/wattroom/server/internal/friends"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// nobody stands in for the hub: no one is online, and a ping goes nowhere.
type nobody struct{}

func (nobody) PresenceChanged()                   {}
func (nobody) PresenceChangedFor([]string)        {}
func (nobody) WhereIs([]string) map[string]string { return nil }
func (nobody) Riding([]string) map[string]bool    { return nil }

type harness struct {
	mux    *http.ServeMux
	st     *store.Store
	users  *testx.Users
	hidden *blocks.Service
}

// setup: alice and bob are accepted friends, cara is nobody's — the shape
// dms_test.go starts from, with the block list, DMs and friends on one mux.
func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)
	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	}
	alice, bob := users.ByToken["alice"].ID, users.ByToken["bob"].ID
	if _, err := st.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{RequesterID: alice, AddresseeID: bob}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{RequesterID: alice, AddresseeID: bob}); err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.DiscardHandler)
	mux := http.NewServeMux()
	hidden := blocks.New(st, users, nobody{}, log)
	hidden.Register(mux)
	dms.New(st, users, nil, log).Register(mux)
	friends.New(st, users, nobody{}, log).Register(mux)
	return &harness{mux: mux, st: st, users: users, hidden: hidden}
}

func (h *harness) id(name string) string { return store.UUIDString(h.users.ByToken[name].ID) }

// call answers the status and the body exactly as it went out.
func (h *harness) call(t *testing.T, user, method, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	return w.Code, w.Body.String()
}

func (h *harness) hide(t *testing.T, who, whom string) {
	t.Helper()
	if code, body := h.call(t, who, http.MethodPost, "/api/blocks", `{"userId":"`+h.id(whom)+`"}`); code != http.StatusOK {
		t.Fatalf("%s hides %s: %d %s", who, whom, code, body)
	}
}

// friendsOf is the friends panel as `user` sees it: id → status.
func (h *harness) friendsOf(t *testing.T, user string) map[string]string {
	t.Helper()
	code, body := h.call(t, user, http.MethodGet, "/api/friends", "")
	if code != http.StatusOK {
		t.Fatalf("%s's friends: %d %s", user, code, body)
	}
	var out struct {
		Friends []struct{ ID, Status string }
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, f := range out.Friends {
		got[f.ID] = f.Status
	}
	return got
}

func TestHidingAnswersAtTheBoundary(t *testing.T) {
	h := setup(t)
	bob := h.id("bob")

	for _, c := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/blocks", ""},
		{http.MethodPost, "/api/blocks", `{"userId":"` + bob + `"}`},
		{http.MethodDelete, "/api/blocks/" + bob, ""},
	} {
		if code, _ := h.call(t, "", c.method, c.path, c.body); code != http.StatusUnauthorized {
			t.Errorf("signed out %s %s: %d", c.method, c.path, code)
		}
	}
	for _, body := range []string{`{"userId":"nope"}`, `{"userId":"` + h.id("alice") + `"}`, `not json`} {
		if code, _ := h.call(t, "alice", http.MethodPost, "/api/blocks", body); code != http.StatusBadRequest {
			t.Errorf("hide %s: %d, want 400", body, code)
		}
	}
	if code, _ := h.call(t, "alice", http.MethodDelete, "/api/blocks/nope", ""); code != http.StatusBadRequest {
		t.Errorf("unhide a junk id: %d", code)
	}
	if code, _ := h.call(t, "alice", http.MethodPost, "/api/blocks", `{"userId":"00000000-0000-4000-8000-000000000000"}`); code != http.StatusNotFound {
		t.Errorf("hide nobody: %d, want 404", code)
	}
	if code, _ := h.call(t, "alice", http.MethodDelete, "/api/blocks/"+bob, ""); code != http.StatusNotFound {
		t.Errorf("unhide someone never hidden: %d, want 404", code)
	}

	h.hide(t, "alice", "bob")
	h.hide(t, "alice", "bob") // twice is once
	if !h.hidden.Hidden(h.id("alice"), bob) || !h.hidden.Hidden(bob, h.id("alice")) {
		t.Fatal("the hub's copy did not hear the block, both ways")
	}
	code, body := h.call(t, "alice", http.MethodGet, "/api/blocks", "")
	if code != http.StatusOK || !strings.Contains(body, `"id":"`+bob+`"`) || !strings.Contains(body, `"name":"bob"`) {
		t.Fatalf("alice's hidden riders: %d %s", code, body)
	}
	// Never the other direction: bob's list is his own, and empty.
	if _, body := h.call(t, "bob", http.MethodGet, "/api/blocks", ""); body != `{"riders":[]}`+"\n" {
		t.Fatalf("bob can read who hid him: %s", body)
	}
	if code, _ := h.call(t, "alice", http.MethodDelete, "/api/blocks/"+bob, ""); code != http.StatusOK {
		t.Fatalf("unhide: %d", code)
	}
	if h.hidden.Hidden(h.id("alice"), bob) {
		t.Fatal("the hub's copy kept a block that was lifted")
	}
}

// A hidden pair's DM thread is closed, and the rider who was hidden cannot
// tell: their refusal is byte for byte a closed thread's (#3202).
func TestAHiddenPairsThreadRefusesExactlyAsAClosedOneDoes(t *testing.T) {
	h := setup(t)
	alice, bob, cara := h.id("alice"), h.id("bob"), h.id("cara")
	if code, _ := h.call(t, "bob", http.MethodPost, "/api/dms/"+alice, `{"text":"before"}`); code != http.StatusOK {
		t.Fatalf("friends should talk before the block: %d", code)
	}
	h.hide(t, "alice", "bob")

	code, hidden := h.call(t, "bob", http.MethodPost, "/api/dms/"+alice, `{"text":"after"}`)
	closedCode, closed := h.call(t, "bob", http.MethodPost, "/api/dms/"+cara, `{"text":"after"}`)
	if code != http.StatusForbidden || code != closedCode || hidden != closed {
		t.Fatalf("the hidden rider's refusal gives the block away:\n hidden %d %q\n closed %d %q", code, hidden, closedCode, closed)
	}
	if code, _ := h.call(t, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"after"}`); code != http.StatusForbidden {
		t.Fatalf("the rider who hid cannot write either: %d", code)
	}
	code, poke := h.call(t, "bob", http.MethodPost, "/api/dms/"+alice+"/poke", `{}`)
	closedCode, closedPoke := h.call(t, "bob", http.MethodPost, "/api/dms/"+cara+"/poke", `{}`)
	if code != closedCode || poke != closedPoke {
		t.Fatalf("a poke across the block gives it away:\n %d %q\n %d %q", code, poke, closedCode, closedPoke)
	}
	for _, who := range []string{"alice", "bob"} {
		if _, heads := h.call(t, who, http.MethodGet, "/api/dms", ""); strings.Contains(heads, "before") {
			t.Fatalf("the thread stayed in %s's list: %s", who, heads)
		}
	}
	// The undo is real: nothing was deleted, so the thread is back as it was.
	if code, _ := h.call(t, "alice", http.MethodDelete, "/api/blocks/"+bob, ""); code != http.StatusOK {
		t.Fatal("unhide")
	}
	if code, _ := h.call(t, "bob", http.MethodPost, "/api/dms/"+alice, `{"text":"again"}`); code != http.StatusOK {
		t.Fatalf("an unhidden friend should talk again: %d", code)
	}
}

// A friendship leaves both lists; the hidden rider's own ask stays pending in
// front of them and never reaches the other side (#3202).
func TestAFriendRequestAcrossAHiddenPairStaysPendingAndNeverArrives(t *testing.T) {
	h := setup(t)
	alice, bob, cara := h.id("alice"), h.id("bob"), h.id("cara")
	h.hide(t, "alice", "bob")
	h.hide(t, "alice", "cara")

	if _, ok := h.friendsOf(t, "alice")[bob]; ok {
		t.Fatal("a hidden friend stayed on alice's list")
	}
	if _, ok := h.friendsOf(t, "bob")[alice]; ok {
		t.Fatal("bob still sees the friend who hid him — presence included")
	}
	// A stale panel's "Remove" is answered as for a friendship already gone.
	code, gone := h.call(t, "bob", http.MethodDelete, "/api/friends/"+alice, "")
	strangerCode, stranger := h.call(t, "bob", http.MethodDelete, "/api/friends/"+cara, "")
	if code != strangerCode || gone != stranger {
		t.Fatalf("unfriending the rider who hid him gives the block away:\n %d %q\n %d %q", code, gone, strangerCode, stranger)
	}

	// cara asks alice by code, as anyone would, and is answered as anyone is.
	code, body := h.call(t, "cara", http.MethodPost, "/api/friends", `{"code":"`+h.users.ByToken["alice"].FriendCode+`"}`)
	if code != http.StatusOK || body != `{"ok":true}`+"\n" {
		t.Fatalf("the hidden rider's ask: %d %s", code, body)
	}
	if got := h.friendsOf(t, "cara")[alice]; got != "pending_out" {
		t.Fatalf("cara's ask should stay pending in front of her, got %q", got)
	}
	if _, ok := h.friendsOf(t, "alice")[cara]; ok {
		t.Fatal("the ask reached the rider who hid its sender")
	}
	if code, _ := h.call(t, "alice", http.MethodPost, "/api/friends/"+cara+"/accept", ""); code != http.StatusNotFound {
		t.Fatalf("an ask across a block was accepted: %d", code)
	}
	// Asking again, where a row already stands, is answered the same way.
	if code, body := h.call(t, "bob", http.MethodPost, "/api/friends", `{"code":"`+h.users.ByToken["alice"].FriendCode+`"}`); code != http.StatusOK {
		t.Fatalf("bob re-asking the friend who hid him: %d %s", code, body)
	}
	// The rider who hid is told why, and the way back.
	code, body = h.call(t, "alice", http.MethodPost, "/api/friends", `{"code":"`+h.users.ByToken["cara"].FriendCode+`"}`)
	if code != http.StatusConflict || !strings.Contains(body, "Hidden riders") {
		t.Fatalf("alice asking someone she hid: %d %s", code, body)
	}
}
