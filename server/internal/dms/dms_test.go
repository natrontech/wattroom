package dms

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

func setup(t *testing.T) (*http.ServeMux, *store.Store, *fakeUsers) {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

	users := &fakeUsers{byToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	// alice ↔ bob are accepted friends; cara is nobody's.
	if err := st.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: users.byToken["alice"].ID, AddresseeID: users.byToken["bob"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{
		RequesterID: users.byToken["alice"].ID, AddresseeID: users.byToken["bob"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return mux, st, users
}

func call(t *testing.T, mux *http.ServeMux, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

func TestDmsAreFriendsOnly(t *testing.T) {
	mux, st, users := setup(t)
	alice := store.UUIDString(users.byToken["alice"].ID)
	bob := store.UUIDString(users.byToken["bob"].ID)
	cara := store.UUIDString(users.byToken["cara"].ID)

	// Boundary: no auth, self, junk id, oversize text.
	if code, _ := call(t, mux, "", http.MethodGet, "/api/dms", ""); code != http.StatusUnauthorized {
		t.Fatalf("unauthed: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+alice, `{"text":"hi me"}`); code != http.StatusBadRequest {
		t.Fatalf("self dm: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+cara, `{"text":"hello stranger"}`); code != http.StatusForbidden {
		t.Fatalf("stranger dm: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"`+strings.Repeat("x", 501)+`"}`); code != http.StatusBadRequest {
		t.Fatalf("oversize: %d", code)
	}

	// Friends can talk; both sides read the same thread.
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"ride at 7?"}`); code != http.StatusOK {
		t.Fatalf("send: %d", code)
	}
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/dms/"+alice, `{"text":"in"}`); code != http.StatusOK {
		t.Fatalf("reply: %d", code)
	}
	code, body := call(t, mux, "bob", http.MethodGet, "/api/dms/"+alice, "")
	msgs, _ := body["messages"].([]any)
	if code != http.StatusOK || len(msgs) != 2 {
		t.Fatalf("thread: %d %v", code, body)
	}
	first, _ := msgs[0].(map[string]any)
	if first["text"] != "ride at 7?" || first["mine"] != false {
		t.Fatalf("thread order/mine: %v", first)
	}

	// Heads: bob sees one conversation, alice's name on it.
	code, body = call(t, mux, "bob", http.MethodGet, "/api/dms", "")
	heads, _ := body["conversations"].([]any)
	if code != http.StatusOK || len(heads) != 1 {
		t.Fatalf("heads: %d %v", code, body)
	}
	head, _ := heads[0].(map[string]any)
	if head["peerName"] != "alice" || head["text"] != "in" || head["mine"] != true {
		t.Fatalf("head: %v", head)
	}

	// Unfriending closes the channel — the gate is the row (ADR-0012).
	if _, err := st.Queries.DeleteFriendship(t.Context(), db.DeleteFriendshipParams{
		RequesterID: users.byToken["alice"].ID, AddresseeID: users.byToken["bob"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"still there?"}`); code != http.StatusForbidden {
		t.Fatalf("post-unfriend dm: %d", code)
	}
}
