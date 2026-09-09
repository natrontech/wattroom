package dms

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/natrontech/wattroom/server/internal/testx"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

func setup(t *testing.T) (*http.ServeMux, *store.Store, *testx.Users) {
	t.Helper()
	st := storetest.Open(t)

	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	// alice ↔ bob are accepted friends; cara is nobody's.
	if err := st.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: users.ByToken["alice"].ID, AddresseeID: users.ByToken["bob"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{
		RequesterID: users.ByToken["alice"].ID, AddresseeID: users.ByToken["bob"].ID,
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
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)
	cara := store.UUIDString(users.ByToken["cara"].ID)

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
		RequesterID: users.ByToken["alice"].ID, AddresseeID: users.ByToken["bob"].ID,
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

// A long thread opens on its newest page (#1813): the query took the OLDEST
// 200 of a pair's 500, so a rider saw a conversation from weeks ago and their
// own send, fetched after the page's last line, fell into the gap.
func TestDmThreadOpensOnItsNewestPage(t *testing.T) {
	mux, st, users := setup(t)
	alice, bob := users.ByToken["alice"], users.ByToken["bob"]
	for i := 1; i <= 250; i++ {
		if _, err := st.Queries.SendDm(t.Context(), db.SendDmParams{
			SenderID: alice.ID, RecipientID: bob.ID, Text: fmt.Sprintf("line %d", i),
		}); err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}
	code, body := call(t, mux, "bob", http.MethodGet, "/api/dms/"+store.UUIDString(alice.ID), "")
	msgs, _ := body["messages"].([]any)
	if code != http.StatusOK || len(msgs) != 200 {
		t.Fatalf("thread: %d, %d lines", code, len(msgs))
	}
	first, _ := msgs[0].(map[string]any)
	last, _ := msgs[199].(map[string]any)
	if first["text"] != "line 51" || last["text"] != "line 250" {
		t.Fatalf("the page runs %v … %v, not line 51 … line 250", first["text"], last["text"])
	}
	// And a poll from the page's last line brings nothing older than it —
	// `after` is a millisecond and the rows are microseconds, so the newest
	// line's own millisecond may ride along, as it always has; the client
	// merges by id.
	at, _ := last["at"].(float64)
	code, body = call(t, mux, "bob", http.MethodGet, fmt.Sprintf("/api/dms/%s?after=%d", store.UUIDString(alice.ID), int64(at)), "")
	tail, _ := body["messages"].([]any)
	if code != http.StatusOK {
		t.Fatalf("poll: %d", code)
	}
	for _, entry := range tail {
		line, _ := entry.(map[string]any)
		if when, _ := line["at"].(float64); when < at {
			t.Fatalf("a poll after the newest line went back to %v", line["text"])
		}
	}
}

func TestDmImages(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)
	cara := store.UUIDString(users.ByToken["cara"].ID)

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
	bob := store.UUIDString(users.ByToken["bob"].ID)
	cara := store.UUIDString(users.ByToken["cara"].ID)

	// bob ↔ cara become friends too, and bob sends cara a picture.
	if err := st.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: users.ByToken["bob"].ID, AddresseeID: users.ByToken["cara"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{
		RequesterID: users.ByToken["bob"].ID, AddresseeID: users.ByToken["cara"].ID,
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

func TestDmReactions(t *testing.T) {
	mux, _, users := setup(t)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)

	// No auth.
	if code, _ := call(t, mux, "", http.MethodPost, "/api/dms/"+bob+"/reactions",
		`{"messageId":"00000000-0000-0000-0000-000000000000","emoji":"🔥"}`); code != http.StatusUnauthorized {
		t.Fatalf("unauthed react: %d", code)
	}

	_, sent := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"ride at 7?"}`)
	id, _ := sent["id"].(string)
	if id == "" {
		t.Fatalf("send: %v", sent)
	}

	// Validation: junk emoji is a field-level 400.
	code, body := call(t, mux, "bob", http.MethodPost, "/api/dms/"+alice+"/reactions",
		`{"messageId":"`+id+`","emoji":"NOT_a_valid_reaction!!"}`)
	if code != http.StatusBadRequest || body["field"] != "emoji" {
		t.Fatalf("bad emoji: %d %v", code, body)
	}

	// Not found: a message id that does not exist in this pair's thread.
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/dms/"+alice+"/reactions",
		`{"messageId":"00000000-0000-0000-0000-000000000000","emoji":"🔥"}`); code != http.StatusNotFound {
		t.Fatalf("missing message: %d", code)
	}

	// Happy path: bob reacts to alice's message — added, count 1.
	code, body = call(t, mux, "bob", http.MethodPost, "/api/dms/"+alice+"/reactions",
		`{"messageId":"`+id+`","emoji":"🔥"}`)
	if code != http.StatusOK || body["added"] != true || body["count"] != float64(1) {
		t.Fatalf("react: %d %v", code, body)
	}

	// The thread response carries the count at the top level, for both
	// sides of the pair — and which emoji the caller themselves pressed.
	_, thread := call(t, mux, "alice", http.MethodGet, "/api/dms/"+bob, "")
	reactions, _ := thread["reactions"].(map[string]any)
	byMessage, _ := reactions[id].(map[string]any)
	if byMessage["🔥"] != float64(1) {
		t.Fatalf("thread reactions: %v", thread)
	}
	_, bobThread := call(t, mux, "bob", http.MethodGet, "/api/dms/"+alice, "")
	bobMyReacts, _ := bobThread["myReacts"].(map[string]any)
	mine, _ := bobMyReacts[id].([]any)
	if len(mine) != 1 || mine[0] != "🔥" {
		t.Fatalf("bob's myReacts: %v", bobThread)
	}

	// Toggling again removes it — added false, count 0.
	code, body = call(t, mux, "bob", http.MethodPost, "/api/dms/"+alice+"/reactions",
		`{"messageId":"`+id+`","emoji":"🔥"}`)
	if code != http.StatusOK || body["added"] != false || body["count"] != float64(0) {
		t.Fatalf("un-react: %d %v", code, body)
	}
}

func TestDmReactionRefusedAcrossPairs(t *testing.T) {
	mux, st, users := setup(t)
	alice := store.UUIDString(users.ByToken["alice"].ID)
	bob := store.UUIDString(users.ByToken["bob"].ID)

	_, sent := call(t, mux, "alice", http.MethodPost, "/api/dms/"+bob, `{"text":"ride at 7?"}`)
	id, _ := sent["id"].(string)
	if id == "" {
		t.Fatalf("send: %v", sent)
	}

	// cara is friendless with alice — she has no thread with alice at all,
	// so alice's message is not in "her" pair either way.
	if code, _ := call(t, mux, "cara", http.MethodPost, "/api/dms/"+alice+"/reactions",
		`{"messageId":"`+id+`","emoji":"🔥"}`); code != http.StatusNotFound {
		t.Fatalf("cross-pair reaction accepted: %d", code)
	}

	// bob ↔ cara become friends and talk; cara must not react to alice and
	// bob's message by addressing it through her own thread with bob.
	if err := st.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: users.ByToken["bob"].ID, AddresseeID: users.ByToken["cara"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{
		RequesterID: users.ByToken["bob"].ID, AddresseeID: users.ByToken["cara"].ID,
	}); err != nil {
		t.Fatal(err)
	}
	if code, _ := call(t, mux, "cara", http.MethodPost, "/api/dms/"+bob+"/reactions",
		`{"messageId":"`+id+`","emoji":"🔥"}`); code != http.StatusNotFound {
		t.Fatalf("cross-pair reaction via bob accepted: %d", code)
	}
}
