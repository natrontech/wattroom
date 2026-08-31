package dms

import (
	"bytes"
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

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.User(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
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

// tinyPNG is just the signature — enough for http.DetectContentType.
var tinyPNG = []byte("\x89PNG\r\n\x1a\nrest-of-a-picture")

func postImage(t *testing.T, mux *http.ServeMux, user, peer string, body []byte) (int, string) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/dms/"+peer+"/images", bytes.NewReader(body))
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var out struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(w.Body).Decode(&out)
	return w.Code, out.ID
}

func getImage(t *testing.T, mux *http.ServeMux, user, id string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/dms/images/"+id, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

func TestDmImages(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.byToken["alice"].ID)
	bob := store.UUIDString(users.byToken["bob"].ID)
	cara := store.UUIDString(users.byToken["cara"].ID)

	// The friendship gate applies to bytes exactly as it does to words.
	if code, _ := postImage(t, mux, "", bob, tinyPNG); code != http.StatusUnauthorized {
		t.Fatalf("unauthed upload: %d", code)
	}
	if code, _ := postImage(t, mux, "alice", cara, tinyPNG); code != http.StatusForbidden {
		t.Fatalf("stranger upload: %d", code)
	}
	if code, _ := postImage(t, mux, "alice", bob, []byte("not an image")); code != http.StatusBadRequest {
		t.Fatalf("junk upload: %d", code)
	}

	code, imgID := postImage(t, mux, "alice", bob, tinyPNG)
	if code != http.StatusOK || imgID == "" {
		t.Fatalf("upload: %d %q", code, imgID)
	}

	// Both ends of the pair read it; nobody else does.
	for _, who := range []string{"alice", "bob"} {
		res := getImage(t, mux, who, imgID)
		if res.Code != http.StatusOK || !bytes.Equal(res.Body.Bytes(), tinyPNG) {
			t.Fatalf("%s serve: %d", who, res.Code)
		}
		if res.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: blob served without nosniff", who)
		}
	}
	if res := getImage(t, mux, "cara", imgID); res.Code != http.StatusNotFound {
		t.Fatalf("outsider serve: %d", res.Code)
	}

	// An image-only message is valid; a wordless, imageless one is not.
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"","imageId":"`+imgID+`"}`); code != http.StatusOK {
		t.Fatalf("image-only send: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":""}`); code != http.StatusBadRequest {
		t.Fatalf("empty send: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"x","imageId":"not-a-uuid"}`); code != http.StatusBadRequest {
		t.Fatalf("junk image id: %d", code)
	}

	// The thread carries the id to both readers.
	code, body := call(t, mux, "bob", http.MethodGet, "/api/dms/"+alice, "")
	if code != http.StatusOK {
		t.Fatalf("thread: %d", code)
	}
	msgs, _ := body["messages"].([]any)
	last, _ := msgs[len(msgs)-1].(map[string]any)
	if last["imageId"] != imgID {
		t.Fatalf("thread imageId: %v", last)
	}

	// The conversation list flags it, so a wordless line still previews.
	_, heads := call(t, mux, "bob", http.MethodGet, "/api/dms", "")
	convos, _ := heads["conversations"].([]any)
	head, _ := convos[0].(map[string]any)
	if head["hasImage"] != true || head["text"] != "" {
		t.Fatalf("head: %v", head)
	}
}

func TestDmImageFromAnotherPairIsRefused(t *testing.T) {
	mux, st, users := setup(t)
	bob := store.UUIDString(users.byToken["bob"].ID)
	cara := store.UUIDString(users.byToken["cara"].ID)

	// bob ↔ cara become friends too, and bob sends cara a picture.
	if err := st.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: users.byToken["bob"].ID, AddresseeID: users.byToken["cara"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{
		RequesterID: users.byToken["bob"].ID, AddresseeID: users.byToken["cara"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	_, theirs := postImage(t, mux, "bob", cara, tinyPNG)
	if theirs == "" {
		t.Fatal("bob→cara upload failed")
	}

	// alice must not be able to pin their blob by referencing it: serving
	// would 404 her anyway, but the reference alone would defeat the sweep.
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob,
		`{"text":"look","imageId":"`+theirs+`"}`); code != http.StatusForbidden {
		t.Fatalf("cross-pair image accepted: %d", code)
	}
}
