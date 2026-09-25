package friends

import (
	"context"
	"encoding/json"
	"github.com/natrontech/wattroom/server/internal/testx"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// fakePresence stands in for the hub: userID → voice channel id ("" for
// online in none), who of them is pedalling, plus a count of the lobby pings
// a mutation asked for (#876).
type fakePresence struct {
	where  map[string]string
	riding map[string]bool
	pings  int
}

func (f *fakePresence) PresenceChanged() { f.pings++ }

func (f *fakePresence) Riding(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		if f.riding[id] {
			out[id] = true
		}
	}
	return out
}

func (f *fakePresence) WhereIs(ids []string) map[string]string {
	out := map[string]string{}
	for _, id := range ids {
		if channel, ok := f.where[id]; ok {
			out[id] = channel
		}
	}
	return out
}

func setup(t *testing.T) (*http.ServeMux, *store.Store, *testx.Users, *fakePresence) {
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
	presence := &fakePresence{where: map[string]string{}, riding: map[string]bool{}}
	mux := http.NewServeMux()
	New(st, users, presence, slog.New(slog.DiscardHandler)).Register(mux)
	return mux, st, users, presence
}

// shareCrew founds a crew owned by the first of the named users, the rest
// its members, with one open voice channel of the crew's name — the channel
// they share, in a crew no room became. It returns the crew and that
// channel's id, which is what the hub's WhereIs answers.
func shareCrew(t *testing.T, st *store.Store, users *testx.Users, name string, names ...string) (pgtype.UUID, string) {
	t.Helper()
	members := make([]pgtype.UUID, 0, len(names)-1)
	for _, member := range names[1:] {
		members = append(members, users.ByToken[member].ID)
	}
	crew := testx.Crew(t, st, name, users.ByToken[names[0]].ID, members...)
	return crew, testx.Voice(t, st, crew, name, false)
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
	cave, caveVoice := shareCrew(t, st, users, "friends-cave", "alice", "bob")
	alice, bob := users.ByToken["alice"], users.ByToken["bob"]

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

	// Presence: bob is in the channel they share — alice sees online AND
	// where: the crew and the voice channel, by id and by name.
	presence.where[store.UUIDString(bob.ID)] = caveVoice
	entry := friendsOf(t, mux, "alice")[0]
	place := placeOf(entry)
	if entry["status"] != "accepted" || entry["online"] != true || entry["inVoice"] != true ||
		place["crewId"] != store.UUIDString(cave) || place["channelId"] != caveVoice ||
		place["crewName"] != "friends-cave" || place["channelName"] != "friends-cave" {
		t.Fatalf("presence entry: %+v", entry)
	}

	// In a channel of a crew alice is not in: online yes, in voice yes, the
	// channel and its crew withheld — the gate holds.
	_, lairVoice := shareCrew(t, st, users, "friends-lair", "bob")
	presence.where[store.UUIDString(bob.ID)] = lairVoice
	entry = friendsOf(t, mux, "alice")[0]
	if entry["online"] != true || entry["inVoice"] != true || entry["channel"] != nil {
		t.Fatalf("boundary pierced: %+v", entry)
	}

	// Lobby-only (#251): present in the map with "" = app open, no channel —
	// Slack's green dot without a location.
	presence.where[store.UUIDString(bob.ID)] = ""
	entry = friendsOf(t, mux, "alice")[0]
	if entry["online"] != true || entry["inVoice"] != nil || entry["channel"] != nil {
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
	alice, bob := users.ByToken["alice"], users.ByToken["bob"]
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

// TestFriendsPanelBatchesPlaceLookups covers the #687 fix with more than one
// online friend at once: one friend in a channel alice may enter, one in a
// channel she may not. The lookup is one query behind the scenes — this
// asserts the per-friend output is still correct once there is more than
// one row to resolve.
func TestFriendsPanelBatchesPlaceLookups(t *testing.T) {
	mux, st, users, presence := setup(t)
	_, cave := shareCrew(t, st, users, "friends-cave", "alice", "bob")
	_, lair := shareCrew(t, st, users, "friends-lair", "cara")

	if code := request(t, mux, "alice", users.ByToken["bob"].FriendCode); code != http.StatusOK {
		t.Fatalf("request bob: %d", code)
	}
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/friends/"+store.UUIDString(users.ByToken["alice"].ID)+"/accept"); code != http.StatusOK {
		t.Fatalf("bob accept: %d", code)
	}
	if code := request(t, mux, "alice", users.ByToken["cara"].FriendCode); code != http.StatusOK {
		t.Fatalf("request cara: %d", code)
	}
	if code, _ := call(t, mux, "cara", http.MethodPost, "/api/friends/"+store.UUIDString(users.ByToken["alice"].ID)+"/accept"); code != http.StatusOK {
		t.Fatalf("cara accept: %d", code)
	}

	presence.where[store.UUIDString(users.ByToken["bob"].ID)] = cave  // alice may enter it
	presence.where[store.UUIDString(users.ByToken["cara"].ID)] = lair // alice may not

	byName := map[string]map[string]any{}
	for _, entry := range friendsOf(t, mux, "alice") {
		name, _ := entry["name"].(string)
		byName[name] = entry
	}

	bobEntry := byName["bob"]
	if place := placeOf(bobEntry); bobEntry["online"] != true || place["channelId"] != cave || place["channelName"] != "friends-cave" {
		t.Fatalf("bob entry (shared channel): %+v", bobEntry)
	}
	caraEntry := byName["cara"]
	if caraEntry["online"] != true || caraEntry["inVoice"] != true || caraEntry["channel"] != nil {
		t.Fatalf("cara entry (boundary should hold): %+v", caraEntry)
	}
}

// The panel's third state (#1743, ADR-0012 amended 2026-09-09). It carried
// online and in-a-room and nothing else, so a friend on the pedals read
// exactly like a friend chatting in the lounge — and the client had nothing
// to build "riding elsewhere" out of for a channel it may not name.
func TestFriendsPanelReportsRiding(t *testing.T) {
	mux, st, users, presence := setup(t)
	_, ridingCave := shareCrew(t, st, users, "riding-cave", "alice", "bob")
	_, ridingLair := shareCrew(t, st, users, "riding-lair", "cara")
	befriend(t, mux, users, "alice", "bob")
	befriend(t, mux, users, "alice", "cara")
	id := func(name string) string { return store.UUIDString(users.ByToken[name].ID) }

	// bob shares the channel with alice and is pedalling; cara is pedalling
	// in a channel alice may not enter; the viewer may learn the fact, never
	// the place. Both are the same one hub answer, filtered by the gate.
	presence.where[id("bob")] = ridingCave
	presence.riding[id("bob")] = true
	presence.where[id("cara")] = ridingLair
	presence.riding[id("cara")] = true

	byName := map[string]map[string]any{}
	for _, entry := range friendsOf(t, mux, "alice") {
		name, _ := entry["name"].(string)
		byName[name] = entry
	}
	if got := byName["bob"]; got["riding"] != true || placeOf(got)["channelName"] != "riding-cave" {
		t.Fatalf("bob riding in a shared channel: %+v", got)
	}
	if got := byName["cara"]; got["riding"] != true || got["channel"] != nil {
		t.Fatalf("cara riding elsewhere — the channel must stay unnamed: %+v", got)
	}

	// Standing in the channel is not riding in it, and the two must not
	// collapse into each other: the whole reason the flag exists.
	presence.riding[id("bob")] = false
	for _, entry := range friendsOf(t, mux, "alice") {
		if entry["name"] == "bob" && entry["riding"] != nil {
			t.Fatalf("bob sat in the lounge still reads as riding: %+v", entry)
		}
	}

	// Online with no channel at all: nothing to ride in, whatever the hub
	// says.
	presence.where[id("bob")] = ""
	presence.riding[id("bob")] = true
	for _, entry := range friendsOf(t, mux, "alice") {
		if entry["name"] == "bob" && entry["riding"] != nil {
			t.Fatalf("bob riding in no channel: %+v", entry)
		}
	}
}

// Where a friend is, in a crew founded since M9 (#2516): the hub names a
// voice channel and the panel names it — crew and channel — only to a viewer
// that channel's gate admits (ADR-0058; ADR-0012: friendship never pierces
// it). A channel no room became used to read as "online" and nothing more,
// and one the viewer may not enter must still say riding without saying
// where. Ordered: each step is the state the one before left behind.
func TestAFriendsPlaceIsNamedOnlyThroughTheGate(t *testing.T) {
	mux, st, users, presence := setup(t)
	alice, bob, cara := users.ByToken["alice"].ID, users.ByToken["bob"].ID, users.ByToken["cara"].ID
	crew := testx.Crew(t, st, "Gate Crew", cara, alice, bob)
	openRoad := testx.Voice(t, st, crew, "Open Road", false)
	backRoom := testx.Voice(t, st, crew, "Back Room", true, bob)
	befriend(t, mux, users, "alice", "bob")
	bobID := store.UUIDString(bob)

	openRoadPlace := map[string]any{
		"crewId": store.UUIDString(crew), "crewName": "Gate Crew",
		"channelId": openRoad, "channelName": "Open Road",
	}
	steps := []struct {
		name    string
		arrange func()
		want    map[string]any
		place   map[string]any // nil: the channel must not be named at all
	}{
		{"riding in an open channel of a crew both are in", func() {
			presence.where[bobID] = openRoad
			presence.riding[bobID] = true
		}, map[string]any{"online": true, "inVoice": true, "riding": true}, openRoadPlace},
		{"riding in a private channel nobody named alice into", func() {
			presence.where[bobID] = backRoom
		}, map[string]any{"online": true, "inVoice": true, "riding": true}, nil},
		{"standing in that private channel", func() {
			presence.riding[bobID] = false
		}, map[string]any{"online": true, "inVoice": true, "riding": nil}, nil},
		{"offline", func() {
			delete(presence.where, bobID)
		}, map[string]any{"online": nil, "inVoice": nil, "riding": nil}, nil},
		{"riding in the open channel of a crew that banned alice", func() {
			if err := st.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{CrewID: crew, UserID: alice, Role: "banned"}); err != nil {
				t.Fatalf("ban alice: %v", err)
			}
			presence.where[bobID] = openRoad
			presence.riding[bobID] = true
		}, map[string]any{"online": true, "inVoice": true, "riding": true}, nil},
	}
	for _, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			step.arrange()
			entries := friendsOf(t, mux, "alice")
			if len(entries) != 1 {
				t.Fatalf("alice's friends: %+v", entries)
			}
			entry := entries[0]
			for key, want := range step.want {
				if got := entry[key]; got != want {
					t.Errorf("%s = %v, want %v (entry %+v)", key, got, want, entry)
				}
			}
			if step.place == nil {
				if entry["channel"] != nil {
					t.Errorf("the channel is named past its gate: %+v", entry)
				}
				return
			}
			if got := placeOf(entry); !maps.Equal(got, step.place) {
				t.Errorf("channel = %v, want %v", got, step.place)
			}
		})
	}
}

// placeOf is the channel an entry names, or nil.
func placeOf(entry map[string]any) map[string]any {
	place, _ := entry["channel"].(map[string]any)
	return place
}

// befriend runs the two-step the panel needs before presence means anything.
func befriend(t *testing.T, mux *http.ServeMux, users *testx.Users, asker, target string) {
	t.Helper()
	if code := request(t, mux, asker, users.ByToken[target].FriendCode); code != http.StatusOK {
		t.Fatalf("%s asks %s: %d", asker, target, code)
	}
	if code, _ := call(t, mux, target, http.MethodPost,
		"/api/friends/"+store.UUIDString(users.ByToken[asker].ID)+"/accept"); code != http.StatusOK {
		t.Fatalf("%s accepts %s: %d", target, asker, code)
	}
}

func TestFriendCodeIsTheOnlyDoor(t *testing.T) {
	mux, _, users, _ := setup(t)

	// The list hands back my own code and never a user listing.
	_, body := call(t, mux, "alice", http.MethodGet, "/api/friends")
	if body["code"] != users.ByToken["alice"].FriendCode {
		t.Fatalf("own code missing: %v", body)
	}
	if _, leaked := body["candidates"]; leaked {
		t.Fatal("candidate listing still exposed")
	}

	// cara shares no room with alice — her code alone opens the door.
	if code := request(t, mux, "alice", users.ByToken["cara"].FriendCode); code != http.StatusOK {
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

func TestASharedChannelIsTheOtherDoor(t *testing.T) {
	mux, st, users, _ := setup(t)
	shareCrew(t, st, users, "friends-cave", "alice", "bob")
	id := func(name string) string { return store.UUIDString(users.ByToken[name].ID) }

	tests := []struct {
		name string
		user string
		id   string
		want int
	}{
		{"malformed id", "alice", "nope", http.StatusBadRequest},
		{"yourself", "alice", id("alice"), http.StatusBadRequest},
		{"no channel in common", "alice", id("cara"), http.StatusNotFound},
		{"crew-mate", "alice", id("bob"), http.StatusOK},
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

// errors.md: every endpoint answers 401 signed out (#1653); the friend-code
// door has a ceiling (#1652).
func TestFriendDoorsSignedOutAndTheCeiling(t *testing.T) {
	mux, st, users, _ := setup(t)
	shareCrew(t, st, users, "door-cave", "alice", "bob")
	bob := users.ByToken["bob"]
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/api/friends"},
		{http.MethodPost, "/api/friends/" + store.UUIDString(bob.ID) + "/accept"},
		{http.MethodDelete, "/api/friends/" + store.UUIDString(bob.ID)},
		{http.MethodPost, "/api/friends/" + store.UUIDString(bob.ID) + "/restore"},
	} {
		if code, _ := call(t, mux, "", tc.method, tc.path); code != http.StatusUnauthorized {
			t.Errorf("%s %s signed out: %d, want 401", tc.method, tc.path, code)
		}
	}
	for i := 0; i < asksPerWindow; i++ {
		if code := request(t, mux, "alice", "ZZZZZZZZ"); code != http.StatusNotFound {
			t.Fatalf("guess %d: %d, want 404", i, code)
		}
	}
	if code := request(t, mux, "alice", "ZZZZZZZZ"); code != http.StatusTooManyRequests {
		t.Fatalf("past the ceiling: %d, want 429", code)
	}
}

// Dismiss has an undo (#1652): their ask comes back and the tombstone that
// told them goes.
func TestDismissCanBeUndone(t *testing.T) {
	mux, st, users, _ := setup(t)
	shareCrew(t, st, users, "undo-cave", "alice", "bob")
	alice, bob := users.ByToken["alice"], users.ByToken["bob"]
	if code := request(t, mux, "bob", alice.FriendCode); code != http.StatusOK {
		t.Fatalf("bob asks alice: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/friends/"+store.UUIDString(bob.ID)); code != http.StatusOK {
		t.Fatalf("dismiss: %d", code)
	}
	if got := declinesOf(t, mux, "bob"); len(got) != 1 {
		t.Fatalf("bob should have been told once, got %v", got)
	}
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(bob.ID)+"/restore"); code != http.StatusOK {
		t.Fatalf("restore: %d", code)
	}
	if got := declinesOf(t, mux, "bob"); len(got) != 0 {
		t.Fatalf("the tombstone should be gone, got %v", got)
	}
	pending := false
	for _, f := range friendsOf(t, mux, "alice") {
		if f["id"] == store.UUIDString(bob.ID) && f["status"] == "pending_in" {
			pending = true
		}
	}
	if !pending {
		t.Fatal("bob's ask did not come back as pending")
	}
}

// The undo is the undo of a dismissal and nothing else (#2225). Unconditional,
// the insert MADE a pending request — `status` defaults to 'pending' — so
// restore-then-accept befriended a rider who was never asked, with neither the
// friend code ADR-0012 makes the permission to ask nor a shared room.
func TestRestoreWithoutADismissalIsRefused(t *testing.T) {
	mux, st, users, _ := setup(t)
	shareCrew(t, st, users, "forge-cave", "alice", "bob")
	alice, bob := users.ByToken["alice"], users.ByToken["bob"]

	code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(bob.ID)+"/restore")
	if code != http.StatusNotFound {
		t.Fatalf("restore with nothing to undo: %d, want 404", code)
	}
	if got := friendsOf(t, mux, "alice"); len(got) != 0 {
		t.Fatalf("alice has a standing she was never given: %v", got)
	}
	if got := friendsOf(t, mux, "bob"); len(got) != 0 {
		t.Fatalf("bob was befriended without being asked: %v", got)
	}
	// And the second half of the two-call forgery has nothing to accept.
	if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(bob.ID)+"/accept"); code != http.StatusNotFound {
		t.Fatalf("accept after the refused restore: %d, want 404", code)
	}
	if got := friendsOf(t, mux, "bob"); len(got) != 0 {
		t.Fatalf("bob ended up a friend: %v", got)
	}
	_ = alice
}

// The undo toast is one button and a rider can press it twice; the second
// press has nothing to write and is not an error.
func TestRestoreTwiceIsNotAnError(t *testing.T) {
	mux, st, users, _ := setup(t)
	shareCrew(t, st, users, "twice-cave", "alice", "bob")
	bob := users.ByToken["bob"]
	if code := request(t, mux, "bob", users.ByToken["alice"].FriendCode); code != http.StatusOK {
		t.Fatalf("bob asks alice: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/friends/"+store.UUIDString(bob.ID)); code != http.StatusOK {
		t.Fatalf("dismiss: %d", code)
	}
	for i := range 2 {
		if code, _ := call(t, mux, "alice", http.MethodPost, "/api/friends/"+store.UUIDString(bob.ID)+"/restore"); code != http.StatusOK {
			t.Fatalf("restore %d: %d, want 200", i+1, code)
		}
	}
}

// A status line reaches a friend and not an ask (ADR-0060 beside ADR-0012):
// accepting is the opt-in, for the words a rider wrote as for presence.
func TestAStatusLineIsAnAcceptedFriends(t *testing.T) {
	mux, st, users, _ := setup(t)
	befriend(t, mux, users, "alice", "bob")
	if code := request(t, mux, "cara", users.ByToken["alice"].FriendCode); code != http.StatusOK {
		t.Fatalf("cara asks alice: %d", code)
	}
	text := "Recovery week"
	if err := st.Queries.SetUserStatus(t.Context(), db.SetUserStatusParams{
		ID: users.ByToken["alice"].ID, Text: &text,
	}); err != nil {
		t.Fatalf("status: %v", err)
	}
	lineOf := func(viewer string) any {
		for _, f := range friendsOf(t, mux, viewer) {
			if f["name"] == "alice" {
				return f["statusLine"]
			}
		}
		t.Fatalf("%s does not list alice", viewer)
		return nil
	}
	if line, _ := lineOf("bob").(map[string]any); line["text"] != text {
		t.Fatalf("her friend reads %v, want %q", lineOf("bob"), text)
	}
	if line := lineOf("cara"); line != nil {
		t.Fatalf("a pending ask read her status: %v", line)
	}
}

// The undo after a withdrawal or an unfriending asks again (#2842, #2008),
// and most friendships are made by code between riders with no channel in
// common (ADR-0012). The ask by id needs a shared channel, so for exactly
// those friends the undo always failed — and spent an ask doing it. Having
// just been connected is the permission; only the rider who parted holds it.
func TestTakingItBackAsksAgain(t *testing.T) {
	mux, _, users, _ := setup(t)
	alice, bob := users.ByToken["alice"], users.ByToken["bob"]
	id := func(u db.User) string { return store.UUIDString(u.ID) }
	statusOf := func(user string) any {
		t.Helper()
		list := friendsOf(t, mux, user)
		if len(list) == 0 {
			return nil
		}
		return list[0]["status"]
	}

	// A code-made ask, withdrawn, then taken back — with the hour's asks spent.
	if code := request(t, mux, "alice", bob.FriendCode); code != http.StatusOK {
		t.Fatalf("alice asks bob by code: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/friends/"+id(bob)); code != http.StatusOK {
		t.Fatalf("alice withdraws: %d", code)
	}
	for i := 1; i < asksPerWindow; i++ {
		request(t, mux, "alice", "ZZZZZZZZ")
	}
	if code := requestByID(t, mux, "alice", id(bob)); code != http.StatusOK {
		t.Fatalf("alice takes the withdrawal back: %d, want 200 — no shared channel, no asks left, and it is still her own ask", code)
	}
	if got := statusOf("bob"); got != "pending_in" {
		t.Fatalf("bob sees %v, want alice's ask again", got)
	}

	// A friendship, removed, then taken back by the one who removed it.
	if code, _ := call(t, mux, "bob", http.MethodPost, "/api/friends/"+id(alice)+"/accept"); code != http.StatusOK {
		t.Fatalf("bob accepts: %d", code)
	}
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/friends/"+id(bob)); code != http.StatusOK {
		t.Fatalf("alice removes bob: %d", code)
	}
	// The rider who was removed holds no such permission.
	if code := requestByID(t, mux, "bob", id(alice)); code != http.StatusNotFound {
		t.Fatalf("the removed rider asks by id: %d, want 404", code)
	}
	if code := requestByID(t, mux, "alice", id(bob)); code != http.StatusOK {
		t.Fatalf("alice takes the removal back: %d, want 200", code)
	}
	if got := statusOf("bob"); got != "pending_in" {
		t.Fatalf("bob sees %v, want alice's ask — acceptance is his to give again", got)
	}
	// Spent on that one ask: once bob dismisses it, alice is metered again.
	if code, _ := call(t, mux, "bob", http.MethodDelete, "/api/friends/"+id(alice)); code != http.StatusOK {
		t.Fatalf("bob dismisses: %d", code)
	}
	if code := requestByID(t, mux, "alice", id(bob)); code != http.StatusTooManyRequests {
		t.Fatalf("alice asks by id again: %d, want 429 — the undo was hers once", code)
	}
}

// The door a rider page asks through is a shared channel, and it says so in
// this app's words (ADR-0058: "room" left the vocabulary).
func TestNoSharedChannelSaysChannel(t *testing.T) {
	mux, _, users, _ := setup(t)
	body := strings.NewReader(`{"userId":"` + store.UUIDString(users.ByToken["cara"].ID) + `"}`)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/friends", body)
	req.Header.Set("X-Test-User", "alice")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", w.Code)
	}
	msg := w.Body.String()
	if strings.Contains(msg, "room") || !strings.Contains(msg, "channel") {
		t.Errorf("the refusal reads %s — want a shared channel, and no room", msg)
	}
}
