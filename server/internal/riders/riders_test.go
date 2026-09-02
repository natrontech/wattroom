package riders

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

// fakePresence stands in for the hub: userID → room slug, plus who is riding
// where, by display name — the hub's own vocabulary.
type fakePresence struct {
	where  map[string]string
	riding map[string][]string
}

func (f *fakePresence) WhereIs(ids []string) map[string]string {
	out := map[string]string{}
	for _, id := range ids {
		if slug, ok := f.where[id]; ok {
			out[id] = slug
		}
	}
	return out
}

func (f *fakePresence) Presence(slug string) protocol.RoomPresence {
	return protocol.RoomPresence{Riding: f.riding[slug]}
}

type harness struct {
	mux      *http.ServeMux
	store    *store.Store
	users    *fakeUsers
	presence *fakePresence
}

func setup(t *testing.T) *harness {
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
	for _, name := range []string{"alice", "bob", "cara", "dan"} {
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
	presence := &fakePresence{where: map[string]string{}, riding: map[string][]string{}}
	mux := http.NewServeMux()
	New(st, users, presence, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{mux: mux, store: st, users: users, presence: presence}
}

func (h *harness) id(name string) string { return store.UUIDString(h.users.byToken[name].ID) }

// room puts the named users into one room owned by the first.
func (h *harness) room(t *testing.T, slug string, names ...string) db.Room {
	t.Helper()
	room, err := h.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Code: (slug + "AAAAAA")[:6], Slug: slug, Name: slug, OwnerID: h.users.byToken[names[0]].ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	for i, name := range names {
		role := "member"
		if i == 0 {
			role = "owner"
		}
		if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room.ID, UserID: h.users.byToken[name].ID, Role: role,
		}); err != nil {
			t.Fatalf("membership %s: %v", name, err)
		}
	}
	return room
}

// ride writes one summary row; shared marks it for friends; room may be zero.
func (h *harness) ride(t *testing.T, name string, room pgtype.UUID, kj int32, shared bool) pgtype.UUID {
	t.Helper()
	id, err := h.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: h.users.byToken[name].ID, RoomID: room, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		Seconds:   1800, AvgWatts: 200, Kj: kj, Execution: 0.9, FtpWatts: 200,
		Samples: []byte("bytes"), Xp: kj,
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}
	if shared {
		if _, err := h.store.Queries.SetRideShared(t.Context(), db.SetRideSharedParams{
			Shared: true, ID: id, UserID: h.users.byToken[name].ID,
		}); err != nil {
			t.Fatalf("share ride: %v", err)
		}
	}
	return id
}

func (h *harness) befriend(t *testing.T, a, b string) {
	t.Helper()
	ua, ub := h.users.byToken[a].ID, h.users.byToken[b].ID
	if err := h.store.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{RequesterID: ua, AddresseeID: ub}); err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := h.store.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{RequesterID: ua, AddresseeID: ub}); err != nil {
		t.Fatalf("accept: %v", err)
	}
}

func (h *harness) get(t *testing.T, viewer, path string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	if viewer != "" {
		req.Header.Set("X-Test-User", viewer)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

func TestRiderPageGate(t *testing.T) {
	h := setup(t)
	h.room(t, "pain-cave", "alice", "bob")
	h.befriend(t, "alice", "dan")
	// dan asked cara; nothing came of it yet.
	if err := h.store.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: h.users.byToken["dan"].ID, AddresseeID: h.users.byToken["cara"].ID,
	}); err != nil {
		t.Fatalf("request: %v", err)
	}

	tests := []struct {
		name   string
		viewer string
		rider  string
		want   int
		friend string
	}{
		{"signed out", "", "bob", http.StatusUnauthorized, ""},
		{"stranger", "cara", "bob", http.StatusNotFound, ""},
		{"room-mate", "alice", "bob", http.StatusOK, "none"},
		{"friend", "alice", "dan", http.StatusOK, "accepted"},
		{"self", "alice", "alice", http.StatusOK, "self"},
		{"they asked me", "cara", "dan", http.StatusOK, "pending_in"},
		{"I asked them", "dan", "cara", http.StatusNotFound, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, body := h.get(t, tt.viewer, "/api/riders/"+h.id(tt.rider))
			if code != tt.want {
				t.Fatalf("status %d, want %d: %v", code, tt.want, body)
			}
			if tt.friend != "" && body["friend"] != tt.friend {
				t.Fatalf("friend = %v, want %s", body["friend"], tt.friend)
			}
		})
	}
	if code, _ := h.get(t, "alice", "/api/riders/not-a-uuid"); code != http.StatusBadRequest {
		t.Fatalf("malformed id: %d", code)
	}
	if code, _ := h.get(t, "alice", "/api/riders/00000000-0000-0000-0000-000000000000"); code != http.StatusNotFound {
		t.Fatalf("absent id: %d", code)
	}
}

func TestRoomMateSeesWhatTheRoomSees(t *testing.T) {
	h := setup(t)
	cave := h.room(t, "pain-cave", "alice", "bob")
	lair := h.room(t, "secret-lair", "bob", "cara")
	bob := h.users.byToken["bob"].ID
	// Two rides, one medal in each room; only the shared room's medal counts.
	inCave := h.ride(t, "bob", cave.ID, 500, true)
	inLair := h.ride(t, "bob", lair.ID, 300, false)
	for _, m := range []struct {
		room, ride pgtype.UUID
		kind       string
	}{{cave.ID, inCave, "hammer"}, {lair.ID, inLair, "diesel"}} {
		if err := h.store.Queries.CreateMedal(t.Context(), db.CreateMedalParams{RoomID: m.room, UserID: bob, RideID: m.ride, Kind: m.kind}); err != nil {
			t.Fatalf("medal: %v", err)
		}
	}

	_, body := h.get(t, "alice", "/api/riders/"+h.id("bob"))
	if body["displayName"] != "bob" || body["totalKj"] != float64(800) || body["rides"] != float64(2) || body["totalXp"] != float64(800) {
		t.Fatalf("totals: %v", body)
	}
	medals, _ := body["medals"].(map[string]any)
	if medals["hammer"] != float64(1) || medals["diesel"] != nil {
		t.Fatalf("medals leak past the shared room: %v", medals)
	}
	rooms, _ := body["roomsInCommon"].([]any)
	if len(rooms) != 1 {
		t.Fatalf("rooms in common: %v", rooms)
	}
	if room, _ := rooms[0].(map[string]any); room["slug"] != "pain-cave" {
		t.Fatalf("rooms in common: %v", rooms)
	}
	if body["canAdd"] != true || body["sharedRides"] != nil || body["month"] != nil {
		t.Fatalf("a room-mate is not a friend: %v", body)
	}

	// Presence: in the shared room, riding → named and moving.
	h.presence.where[h.id("bob")] = "pain-cave"
	h.presence.riding["pain-cave"] = []string{"bob"}
	_, body = h.get(t, "alice", "/api/riders/"+h.id("bob"))
	p, _ := body["presence"].(map[string]any)
	room, _ := p["room"].(map[string]any)
	if room["slug"] != "pain-cave" || p["riding"] != true || p["online"] != true {
		t.Fatalf("presence in a shared room: %v", p)
	}
	// In a room alice is not in: a room-mate learns nothing at all.
	h.presence.where[h.id("bob")] = "secret-lair"
	_, body = h.get(t, "alice", "/api/riders/"+h.id("bob"))
	p, _ = body["presence"].(map[string]any)
	if p["online"] != false || p["inRoom"] != false || p["room"] != nil {
		t.Fatalf("boundary pierced for a room-mate: %v", p)
	}
}

func TestFriendSeesSharedRidesAndTheMonth(t *testing.T) {
	h := setup(t)
	lair := h.room(t, "secret-lair", "dan", "cara")
	h.befriend(t, "alice", "dan")
	h.ride(t, "dan", lair.ID, 400, true)
	h.ride(t, "dan", pgtype.UUID{}, 250, false)

	_, body := h.get(t, "alice", "/api/riders/"+h.id("dan"))
	if body["canAdd"] != false {
		t.Fatalf("friends are not re-added: %v", body)
	}
	if rooms, _ := body["roomsInCommon"].([]any); len(rooms) != 0 {
		t.Fatalf("no rooms in common expected: %v", rooms)
	}
	shared, _ := body["sharedRides"].([]any)
	if len(shared) != 1 {
		t.Fatalf("shared rides: %v", body["sharedRides"])
	}
	ride, _ := shared[0].(map[string]any)
	// The ride was in a room alice is not a member of: "in a room", unnamed.
	if ride["kj"] != float64(400) || ride["inRoom"] != true || ride["roomName"] != nil {
		t.Fatalf("shared ride: %v", ride)
	}
	month, _ := body["month"].(map[string]any)
	if month["rides"] != float64(2) || month["kj"] != float64(650) || month["seconds"] != float64(3600) {
		t.Fatalf("month: %v", month)
	}

	// A friend in a room you are not in: online and in a room, unnamed.
	h.presence.where[h.id("dan")] = "secret-lair"
	_, body = h.get(t, "alice", "/api/riders/"+h.id("dan"))
	p, _ := body["presence"].(map[string]any)
	if p["online"] != true || p["inRoom"] != true || p["room"] != nil {
		t.Fatalf("friend presence: %v", p)
	}
	// Lobby only: online, nowhere.
	h.presence.where[h.id("dan")] = ""
	_, body = h.get(t, "alice", "/api/riders/"+h.id("dan"))
	p, _ = body["presence"].(map[string]any)
	if p["online"] != true || p["inRoom"] != false {
		t.Fatalf("lobby presence: %v", p)
	}
}

func TestSelfSeesOwnPage(t *testing.T) {
	h := setup(t)
	h.ride(t, "alice", pgtype.UUID{}, 100, true)
	_, body := h.get(t, "alice", "/api/riders/"+h.id("alice"))
	if body["friend"] != "self" || body["canAdd"] != false {
		t.Fatalf("self: %v", body)
	}
	if shared, _ := body["sharedRides"].([]any); len(shared) != 1 {
		t.Fatalf("own shared rides: %v", body["sharedRides"])
	}
}
