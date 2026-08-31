package friends

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
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

// fakePresence stands in for the hub: userID → room slug.
type fakePresence struct{ where map[string]string }

func (f *fakePresence) WhereIs(ids []string) map[string]string {
	out := map[string]string{}
	for _, id := range ids {
		if slug, ok := f.where[id]; ok {
			out[id] = slug
		}
	}
	return out
}

func setup(t *testing.T) (*http.ServeMux, *store.Store, *fakeUsers, *fakePresence) {
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
	presence := &fakePresence{where: map[string]string{}}
	mux := http.NewServeMux()
	New(st, users, presence, slog.New(slog.DiscardHandler)).Register(mux)
	return mux, st, users, presence
}

// shareRoom puts the named users into one room owned by the first.
func shareRoom(t *testing.T, st *store.Store, users *fakeUsers, slug string, names ...string) db.Room {
	t.Helper()
	owner := users.byToken[names[0]]
	code := (slug + "AAAAAA")[:6] // rooms.code is exactly six characters
	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Code: code, Slug: slug, Name: slug, OwnerID: owner.ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	for i, name := range names {
		role := "member"
		if i == 0 {
			role = "owner"
		}
		err := st.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room.ID, UserID: users.byToken[name].ID, Role: role,
		})
		if err != nil {
			t.Fatalf("membership %s: %v", name, err)
		}
	}
	return room
}

func call(t *testing.T, mux *http.ServeMux, user, method, path string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

func friendsOf(t *testing.T, mux *http.ServeMux, user string) []map[string]any {
	t.Helper()
	code, body := call(t, mux, user, http.MethodGet, "/api/friends")
	if code != http.StatusOK {
		t.Fatalf("list for %s: %d", user, code)
	}
	raw, _ := body["friends"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		m, _ := entry.(map[string]any)
		out = append(out, m)
	}
	return out
}

func TestFriendLifecycle(t *testing.T) {
	mux, st, users, presence := setup(t)
	shareRoom(t, st, users, "pain-cave", "alice", "bob")
	alice, bob := users.byToken["alice"], users.byToken["bob"]

	// No auth → 401; garbage id → 400; self → 400.
	if code, _ := call(t, mux, "", http.MethodGet, "/api/friends"); code != http.StatusUnauthorized {
		t.Fatalf("unauthed list: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/not-a-uuid"); code != http.StatusBadRequest {
		t.Fatalf("garbage id: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(alice.ID)); code != http.StatusBadRequest {
		t.Fatalf("self request: %d", code)
	}

	// cara shares no room with alice — the formation gate refuses (ADR-0012).
	cara := users.byToken["cara"]
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(cara.ID)); code != http.StatusForbidden {
		t.Fatalf("stranger request: %d", code)
	}

	// Roommate request → pending both ways; duplicate (either direction) → 409.
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(bob.ID)); code != http.StatusOK {
		t.Fatalf("request: %d", code)
	}
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/friends/"+store.UUIDString(alice.ID)); code != http.StatusConflict {
		t.Fatalf("mirror request: %d", code)
	}
	if got := friendsOf(t, mux, "alice")[0]["status"]; got != "pending_out" {
		t.Fatalf("alice sees %v", got)
	}
	if got := friendsOf(t, mux, "bob")[0]["status"]; got != "pending_in" {
		t.Fatalf("bob sees %v", got)
	}

	// Requester cannot accept their own ask; the addressee can.
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(bob.ID)+"/accept"); code != http.StatusNotFound {
		t.Fatalf("self-accept: %d", code)
	}
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/friends/"+store.UUIDString(alice.ID)+"/accept"); code != http.StatusOK {
		t.Fatalf("accept: %d", code)
	}

	// Presence: bob is in the shared room — alice sees online AND the name.
	presence.where[store.UUIDString(bob.ID)] = "pain-cave"
	entry := friendsOf(t, mux, "alice")[0]
	if entry["status"] != "accepted" || entry["online"] != true || entry["room"] != "pain-cave" {
		t.Fatalf("presence entry: %+v", entry)
	}

	// In a room alice is NOT a member of: online yes, room withheld.
	presence.where[store.UUIDString(bob.ID)] = "secret-lair"
	shareRoom(t, st, users, "secret-lair", "bob")
	entry = friendsOf(t, mux, "alice")[0]
	if entry["online"] != true || entry["room"] != nil {
		t.Fatalf("boundary pierced: %+v", entry)
	}

	// Unfriend from either side deletes; a second delete 404s.
	if code, _ := call(t, mux, "bob", http.MethodDelete, "/api/friends/"+store.UUIDString(alice.ID)); code != http.StatusOK {
		t.Fatalf("unfriend: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/friends/"+store.UUIDString(bob.ID)); code != http.StatusNotFound {
		t.Fatalf("double delete: %d", code)
	}
	if got := len(friendsOf(t, mux, "alice")); got != 0 {
		t.Fatalf("rows left after unfriend: %d", got)
	}
}

func TestCandidatesAreRoommatesOnly(t *testing.T) {
	mux, st, users, _ := setup(t)
	shareRoom(t, st, users, "cave-2", "alice", "bob")
	// cara shares nothing with alice.

	_, body := call(t, mux, "alice", http.MethodGet, "/api/friends")
	raw, _ := body["candidates"].([]any)
	if len(raw) != 1 {
		t.Fatalf("candidates: %v", raw)
	}
	first, _ := raw[0].(map[string]any)
	if first["name"] != "bob" {
		t.Fatalf("candidate is %v", first["name"])
	}

	// Once requested, bob leaves the candidate list.
	bob := users.byToken["bob"]
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(bob.ID)); code != http.StatusOK {
		t.Fatal("request failed")
	}
	_, body = call(t, mux, "alice", http.MethodGet, "/api/friends")
	raw, _ = body["candidates"].([]any)
	if len(raw) != 0 {
		t.Fatalf("candidates after request: %v", raw)
	}
}
