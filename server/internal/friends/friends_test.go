package friends

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
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

// fakePresence stands in for the hub: userID → room slug, plus a count of
// the lobby pings a mutation asked for (#876).
type fakePresence struct {
	where map[string]string
	pings int
}

func (f *fakePresence) PresenceChanged() { f.pings++ }

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
	st := storetest.Open(t)

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
	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: slug, Name: slug, OwnerID: owner.ID,
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

// declinesOf reads the asks that were dismissed — the requester's alone.
func declinesOf(t *testing.T, mux *http.ServeMux, user string) []map[string]any {
	t.Helper()
	code, body := call(t, mux, user, http.MethodGet, "/api/friends")
	if code != http.StatusOK {
		t.Fatalf("list for %s: %d", user, code)
	}
	raw, _ := body["declines"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		m, _ := entry.(map[string]any)
		out = append(out, m)
	}
	return out
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
	// A six-character code is a crew's, pasted into the wrong box: still a
	// 404, but the words send them to Home, not back to their friend.
	crewShaped := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/friends", strings.NewReader(`{"code":"ab12cd"}`))
	crewShaped.Header.Set("X-Test-User", "alice")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, crewShaped)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "crew") {
		t.Fatalf("crew-shaped code: %d %s, want 404 naming the crew", rec.Code, rec.Body.String())
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

	// Nothing refused so far may have pinged the lobby (#876).
	if presence.pings != 0 {
		t.Fatalf("refused requests pinged the lobby %d times", presence.pings)
	}
	// Codes are the only gate — no shared room needed, and case/space forgiven.
	if code := request(t, mux, "alice", "  "+strings.ToLower(bob.FriendCode)+" "); code != http.StatusOK {
		t.Fatalf("request: %d", code)
	}
	// A request bob can be told about: the lobby ping is how he hears (#876).
	if presence.pings != 1 {
		t.Fatalf("request pings: %d", presence.pings)
	}
	// Duplicate (either direction) → 409.
	if code := request(t, mux, "bob", alice.FriendCode); code != http.StatusConflict {
		t.Fatalf("mirror request: %d", code)
	}
	if got := friendsOf(t, mux, "alice")[0]["status"]; got != "pending_out" {
		t.Fatalf("alice sees %v", got)
	}
	// The row's own timestamp — the client announces the request off it.
	if at, ok := friendsOf(t, mux, "bob")[0]["at"].(float64); !ok || at <= 0 {
		t.Fatalf("no request timestamp: %v", friendsOf(t, mux, "bob")[0]["at"])
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
	// Alice hears about it the same way — the refused self-accept above did not.
	if presence.pings != 2 {
		t.Fatalf("accept pings: %d", presence.pings)
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

	// Unfriending is not a dismissal: nothing to tell either of them (#876).
	if code, _ := call(t, mux, "bob", http.MethodDelete, "/api/friends/"+store.UUIDString(alice.ID)); code != http.StatusOK {
		t.Fatalf("unfriend: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/friends/"+store.UUIDString(bob.ID)); code != http.StatusNotFound {
		t.Fatalf("double delete: %d", code)
	}
	if got := len(friendsOf(t, mux, "alice")); got != 0 {
		t.Fatalf("rows left after unfriend: %d", got)
	}
	for _, who := range []string{"alice", "bob"} {
		if got := len(declinesOf(t, mux, who)); got != 0 {
			t.Fatalf("unfriending told %s about it: %d", who, got)
		}
	}
}

// TestADismissalTellsTheRequester is the ADR-0012 amendment (#876): the one
// rider who asked hears that their ask was answered. The same DELETE means
// three different things, and only one of them is anybody's business.
func TestADismissalTellsTheRequester(t *testing.T) {
	mux, _, users, _ := setup(t)
	alice, bob := users.byToken["alice"], users.byToken["bob"]
	ask := func(from string, code string) {
		t.Helper()
		if got := request(t, mux, from, code); got != http.StatusOK {
			t.Fatalf("%s asks: %d", from, got)
		}
	}
	drop := func(who string, target pgtype.UUID) {
		t.Helper()
		if code, _ := call(t, mux, who, http.MethodDelete, "/api/friends/"+store.UUIDString(target)); code != http.StatusOK {
			t.Fatalf("%s deletes: %d", who, code)
		}
	}

	// Alice asks, Bob dismisses: she hears, he has nothing to hear.
	ask("alice", bob.FriendCode)
	drop("bob", alice.ID)
	told := declinesOf(t, mux, "alice")
	if len(told) != 1 || told[0]["name"] != "bob" || told[0]["id"] != store.UUIDString(bob.ID) {
		t.Fatalf("alice was not told: %+v", told)
	}
	if at, ok := told[0]["at"].(float64); !ok || at <= 0 {
		t.Fatalf("no dismissal timestamp: %+v", told[0])
	}
	if got := len(declinesOf(t, mux, "bob")); got != 0 {
		t.Fatalf("bob sees his own dismissal: %d", got)
	}

	// Asking again settles it — the old dismissal must not resurface.
	ask("alice", bob.FriendCode)
	if got := len(declinesOf(t, mux, "alice")); got != 0 {
		t.Fatalf("stale dismissal survived a new ask: %d", got)
	}

	// Cancelling my own ask tells nobody, least of all me.
	drop("alice", bob.ID)
	for _, who := range []string{"alice", "bob"} {
		if got := len(declinesOf(t, mux, who)); got != 0 {
			t.Fatalf("a cancel told %s about it: %d", who, got)
		}
	}

	// An acceptance settles a pair that had been dismissed before.
	ask("alice", bob.FriendCode)
	drop("bob", alice.ID)
	ask("alice", bob.FriendCode)
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/friends/"+store.UUIDString(alice.ID)+"/accept"); code != http.StatusOK {
		t.Fatalf("accept: %d", code)
	}
	if got := len(declinesOf(t, mux, "alice")); got != 0 {
		t.Fatalf("a dismissal outlived the friendship: %d", got)
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
