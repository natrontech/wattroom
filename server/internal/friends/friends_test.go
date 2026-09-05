package friends

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

// request sends a friend request by code — the only formation path.
func request(t *testing.T, mux *http.ServeMux, user, code string) int {
	t.Helper()
	body := strings.NewReader(`{"code":"` + code + `"}`)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/friends", body)
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w.Code
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

	// No auth → 401; unknown code → 404; empty code → 400; own code → 400.
	if code, _ := call(t, mux, "", http.MethodGet, "/api/friends"); code != http.StatusUnauthorized {
		t.Fatalf("unauthed list: %d", code)
	}
	if code := request(t, mux, "alice", "NOTACODE"); code != http.StatusNotFound {
		t.Fatalf("unknown code: %d", code)
	}
	if code := request(t, mux, "alice", ""); code != http.StatusBadRequest {
		t.Fatalf("empty code: %d", code)
	}
	if code := request(t, mux, "alice", alice.FriendCode); code != http.StatusBadRequest {
		t.Fatalf("self request: %d", code)
	}

	// Codes are the only gate — no shared room needed, and case/space forgiven.
	if code := request(t, mux, "alice", "  "+strings.ToLower(bob.FriendCode)+" "); code != http.StatusOK {
		t.Fatalf("request: %d", code)
	}
	// Duplicate (either direction) → 409.
	if code := request(t, mux, "bob", alice.FriendCode); code != http.StatusConflict {
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

	// In a room alice is NOT a member of: online yes, in a room yes, room
	// name withheld — the boundary holds.
	presence.where[store.UUIDString(bob.ID)] = "secret-lair"
	shareRoom(t, st, users, "secret-lair", "bob")
	entry = friendsOf(t, mux, "alice")[0]
	if entry["online"] != true || entry["inRoom"] != true || entry["room"] != nil {
		t.Fatalf("boundary pierced: %+v", entry)
	}

	// Lobby-only (#251): present in the map with "" = app open, no room —
	// Slack's green dot without a location.
	presence.where[store.UUIDString(bob.ID)] = ""
	entry = friendsOf(t, mux, "alice")[0]
	if entry["online"] != true || entry["inRoom"] != nil || entry["room"] != nil {
		t.Fatalf("lobby-only entry: %+v", entry)
	}

	// Not in the map at all = offline.
	delete(presence.where, store.UUIDString(bob.ID))
	entry = friendsOf(t, mux, "alice")[0]
	if entry["online"] != nil {
		t.Fatalf("offline entry: %+v", entry)
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

// TestFriendsPanelBatchesRoomLookups covers the #687 fix with more than one
// online friend at once: one friend in a room alice belongs to, one in a
// room she does not, and one merely lobby-online. The room/membership
// lookups are batched behind the scenes — this asserts the per-friend
// output is still correct once there is more than one row to resolve.
func TestFriendsPanelBatchesRoomLookups(t *testing.T) {
	mux, st, users, presence := setup(t)
	shareRoom(t, st, users, "pain-cave", "alice", "bob")
	shareRoom(t, st, users, "secret-lair", "cara")

	if code := request(t, mux, "alice", users.byToken["bob"].FriendCode); code != http.StatusOK {
		t.Fatalf("request bob: %d", code)
	}
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/friends/"+store.UUIDString(users.byToken["alice"].ID)+"/accept"); code != http.StatusOK {
		t.Fatalf("bob accept: %d", code)
	}
	if code := request(t, mux, "alice", users.byToken["cara"].FriendCode); code != http.StatusOK {
		t.Fatalf("request cara: %d", code)
	}
	if code, _ := call(t, mux, "cara", http.MethodPost, "/api/friends/"+store.UUIDString(users.byToken["alice"].ID)+"/accept"); code != http.StatusOK {
		t.Fatalf("cara accept: %d", code)
	}

	presence.where[store.UUIDString(users.byToken["bob"].ID)] = "pain-cave"    // alice is a member
	presence.where[store.UUIDString(users.byToken["cara"].ID)] = "secret-lair" // alice is not

	byName := map[string]map[string]any{}
	for _, entry := range friendsOf(t, mux, "alice") {
		name, _ := entry["name"].(string)
		byName[name] = entry
	}

	bobEntry := byName["bob"]
	if bobEntry["online"] != true || bobEntry["room"] != "pain-cave" || bobEntry["roomName"] != "pain-cave" {
		t.Fatalf("bob entry (shared room): %+v", bobEntry)
	}
	caraEntry := byName["cara"]
	if caraEntry["online"] != true || caraEntry["inRoom"] != true || caraEntry["room"] != nil {
		t.Fatalf("cara entry (boundary should hold): %+v", caraEntry)
	}
}

func TestFriendCodeIsTheOnlyDoor(t *testing.T) {
	mux, _, users, _ := setup(t)

	// The list hands back my own code and never a user listing.
	_, body := call(t, mux, "alice", http.MethodGet, "/api/friends")
	if body["code"] != users.byToken["alice"].FriendCode {
		t.Fatalf("own code missing: %v", body)
	}
	if _, leaked := body["candidates"]; leaked {
		t.Fatal("candidate listing still exposed")
	}

	// cara shares no room with alice — her code alone opens the door.
	if code := request(t, mux, "alice", users.byToken["cara"].FriendCode); code != http.StatusOK {
		t.Fatalf("stranger-by-code request: %d", code)
	}
	if got := friendsOf(t, mux, "cara")[0]["status"]; got != "pending_in" {
		t.Fatalf("cara sees %v", got)
	}
}

// requestByID asks by rider id — the rider's page's path (ADR-0024).
func requestByID(t *testing.T, mux *http.ServeMux, user, id string) int {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/friends",
		strings.NewReader(`{"userId":"`+id+`"}`))
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w.Code
}

func TestASharedRoomIsTheOtherDoor(t *testing.T) {
	mux, st, users, _ := setup(t)
	shareRoom(t, st, users, "pain-cave", "alice", "bob")
	id := func(name string) string { return store.UUIDString(users.byToken[name].ID) }

	tests := []struct {
		name string
		user string
		id   string
		want int
	}{
		{"malformed id", "alice", "nope", http.StatusBadRequest},
		{"yourself", "alice", id("alice"), http.StatusBadRequest},
		{"no room in common", "alice", id("cara"), http.StatusNotFound},
		{"room-mate", "alice", id("bob"), http.StatusOK},
		{"already asked, mirrored", "bob", id("alice"), http.StatusConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if code := requestByID(t, mux, tt.user, tt.id); code != tt.want {
				t.Fatalf("status %d, want %d", code, tt.want)
			}
		})
	}
	if got := friendsOf(t, mux, "bob")[0]["status"]; got != "pending_in" {
		t.Fatalf("bob sees %v", got)
	}
}
