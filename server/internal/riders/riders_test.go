package riders

import (
	"context"
	"encoding/json"
	"github.com/natrontech/wattroom/server/internal/testx"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// fakePresence stands in for the hub: userID → voice channel id ("" for
// online in none), plus who is riding in which channel — the hub's own
// shape.
type fakePresence struct {
	where  map[string]string
	riding map[string][]string
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

// Ids, not names (#1652): "riding" is keyed by id, and the fixture keeps the
// hub's own shape — a voice channel holds the ids pedalling in it.
func (f *fakePresence) Riding(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		if slices.Contains(f.riding[f.where[id]], id) {
			out[id] = true
		}
	}
	return out
}

type harness struct {
	mux      *http.ServeMux
	store    *store.Store
	users    *testx.Users
	presence *fakePresence
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)

	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara", "dan"} {
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
	presence := &fakePresence{where: map[string]string{}, riding: map[string][]string{}}
	mux := http.NewServeMux()
	New(st, users, presence, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{mux: mux, store: st, users: users, presence: presence}
}

func (h *harness) id(name string) string { return store.UUIDString(h.users.ByToken[name].ID) }

// crewFixture is a crew some riders share and the voice channel it rides in.
// The zero value is nowhere: a solo ride.
type crewFixture struct {
	id    pgtype.UUID
	voice string
}

// crew puts the named users into one crew owned by the first, with a voice
// channel of the crew's name.
func (h *harness) crew(t *testing.T, name string, names ...string) crewFixture {
	t.Helper()
	members := make([]pgtype.UUID, 0, len(names)-1)
	for _, member := range names[1:] {
		members = append(members, h.users.ByToken[member].ID)
	}
	crew := testx.Crew(t, h.store, name, h.users.ByToken[names[0]].ID, members...)
	return crewFixture{id: crew, voice: testx.Voice(t, h.store, crew, name, false)}
}

// ride writes one summary row; shared marks it for friends; at may be zero.
func (h *harness) ride(t *testing.T, name string, at crewFixture, kj int32, shared bool) pgtype.UUID {
	t.Helper()
	var channel pgtype.UUID
	if at.voice != "" {
		var err error
		if channel, err = store.ParseUUID(at.voice); err != nil {
			t.Fatal(err)
		}
	}
	id, err := h.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: h.users.ByToken[name].ID, CrewID: at.id, ChannelID: channel, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		Seconds:   1800, AvgWatts: 200, Kj: kj, Execution: 0.9, FtpWatts: 200,
		Samples: []byte("bytes"), Xp: kj,
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}
	if shared {
		if _, err := h.store.Queries.SetRideShared(t.Context(), db.SetRideSharedParams{
			Shared: true, ID: id, UserID: h.users.ByToken[name].ID,
		}); err != nil {
			t.Fatalf("share ride: %v", err)
		}
	}
	return id
}

func (h *harness) befriend(t *testing.T, a, b string) {
	t.Helper()
	ua, ub := h.users.ByToken[a].ID, h.users.ByToken[b].ID
	if _, err := h.store.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{RequesterID: ua, AddresseeID: ub}); err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := h.store.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{RequesterID: ua, AddresseeID: ub}); err != nil {
		t.Fatalf("accept: %v", err)
	}
}

// avatarPNG is enough of a PNG to be served back byte for byte; nothing here
// decodes it.
const avatarPNG = "\x89PNG\r\n\x1a\nrest-of-a-picture"

// avatar gives the rider a stored picture and returns its address — the one
// the page hands out, so a test fetches what a browser would.
func (h *harness) avatar(t *testing.T, name string) string {
	t.Helper()
	url := "/api/riders/" + h.id(name) + "/avatar"
	if _, err := h.store.Queries.SetUserAvatar(t.Context(), db.SetUserAvatarParams{
		ID: h.users.ByToken[name].ID, Mime: "image/png", Image: []byte(avatarPNG),
		SetAt:     pgtype.Timestamptz{Time: time.Now().Truncate(time.Millisecond), Valid: true},
		AvatarUrl: &url,
	}); err != nil {
		t.Fatalf("set avatar for %s: %v", name, err)
	}
	return url
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
	h.crew(t, "pain-cave", "alice", "bob")
	h.befriend(t, "alice", "dan")
	// dan asked cara; nothing came of it yet.
	if _, err := h.store.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: h.users.ByToken["dan"].ID, AddresseeID: h.users.ByToken["cara"].ID,
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
		{"crew-mate", "alice", "bob", http.StatusOK, "none"},
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

func TestCrewMateSeesWhatTheCrewSees(t *testing.T) {
	h := setup(t)
	cave := h.crew(t, "pain-cave", "alice", "bob")
	lair := h.crew(t, "secret-lair", "bob", "cara")
	bob := h.users.ByToken["bob"].ID
	// Two rides, one medal in each crew; only the shared crew's medal counts.
	inCave := h.ride(t, "bob", cave, 500, true)
	inLair := h.ride(t, "bob", lair, 300, false)
	for _, m := range []struct {
		crew, ride pgtype.UUID
		kind       string
	}{{cave.id, inCave, "hammer"}, {lair.id, inLair, "diesel"}} {
		if err := h.store.Queries.CreateMedal(t.Context(), db.CreateMedalParams{CrewID: m.crew, UserID: bob, RideID: m.ride, Kind: m.kind}); err != nil {
			t.Fatalf("medal: %v", err)
		}
	}

	_, body := h.get(t, "alice", "/api/riders/"+h.id("bob"))
	if body["displayName"] != "bob" || body["totalKj"] != float64(800) || body["rides"] != float64(2) || body["totalXp"] != float64(800) {
		t.Fatalf("totals: %v", body)
	}
	medals, _ := body["medals"].(map[string]any)
	if medals["hammer"] != float64(1) || medals["diesel"] != nil {
		t.Fatalf("medals leak past the shared crew: %v", medals)
	}
	// The one crew both of them are in.
	crews, _ := body["crewsInCommon"].([]any)
	if len(crews) != 1 {
		t.Fatalf("crews in common: %v", crews)
	}
	if crew, _ := crews[0].(map[string]any); crew["name"] != "pain-cave" || crew["id"] != store.UUIDString(cave.id) {
		t.Fatalf("crews in common: %v", crews)
	}
	if body["canAdd"] != true || body["sharedRides"] != nil || body["month"] != nil {
		t.Fatalf("a crew-mate is not a friend: %v", body)
	}

	// Presence: in the channel they share, riding → named and moving.
	h.presence.where[h.id("bob")] = cave.voice
	h.presence.riding[cave.voice] = []string{h.id("bob")}
	_, body = h.get(t, "alice", "/api/riders/"+h.id("bob"))
	p, _ := body["presence"].(map[string]any)
	channel, _ := p["channel"].(map[string]any)
	if channel["channelId"] != cave.voice || channel["channelName"] != "pain-cave" || p["riding"] != true || p["online"] != true || p["inVoice"] != true {
		t.Fatalf("presence in a shared channel: %v", p)
	}
	// In a channel alice may not enter: a crew-mate learns nothing at all.
	h.presence.where[h.id("bob")] = lair.voice
	_, body = h.get(t, "alice", "/api/riders/"+h.id("bob"))
	p, _ = body["presence"].(map[string]any)
	if p["online"] != false || p["inVoice"] != false || p["channel"] != nil {
		t.Fatalf("boundary pierced for a crew-mate: %v", p)
	}
}

func TestFriendSeesSharedRidesAndTheMonth(t *testing.T) {
	h := setup(t)
	lair := h.crew(t, "secret-lair", "dan", "cara")
	h.befriend(t, "alice", "dan")
	h.ride(t, "dan", lair, 400, true)
	h.ride(t, "dan", crewFixture{}, 250, false)

	_, body := h.get(t, "alice", "/api/riders/"+h.id("dan"))
	if body["canAdd"] != false {
		t.Fatalf("friends are not re-added: %v", body)
	}
	if crews, _ := body["crewsInCommon"].([]any); len(crews) != 0 {
		t.Fatalf("no crews in common expected: %v", crews)
	}
	shared, _ := body["sharedRides"].([]any)
	if len(shared) != 1 {
		t.Fatalf("shared rides: %v", body["sharedRides"])
	}
	ride, _ := shared[0].(map[string]any)
	// The ride was in a channel alice may not enter: "in a room", unnamed.
	if ride["kj"] != float64(400) || ride["inRoom"] != true || ride["roomName"] != nil {
		t.Fatalf("shared ride: %v", ride)
	}
	month, _ := body["month"].(map[string]any)
	if month["rides"] != float64(2) || month["kj"] != float64(650) || month["seconds"] != float64(3600) {
		t.Fatalf("month: %v", month)
	}

	// A friend in a channel you may not enter: online and in voice, unnamed.
	h.presence.where[h.id("dan")] = lair.voice
	_, body = h.get(t, "alice", "/api/riders/"+h.id("dan"))
	p, _ := body["presence"].(map[string]any)
	if p["online"] != true || p["inVoice"] != true || p["channel"] != nil {
		t.Fatalf("friend presence: %v", p)
	}
	// Lobby only: online, nowhere.
	h.presence.where[h.id("dan")] = ""
	_, body = h.get(t, "alice", "/api/riders/"+h.id("dan"))
	p, _ = body["presence"].(map[string]any)
	if p["online"] != true || p["inVoice"] != false {
		t.Fatalf("lobby presence: %v", p)
	}
}

// Where a rider is, on their page, in a crew founded since M9 (#2516): the
// hub names a voice channel, and the page names it — crew and channel —
// only to a viewer that channel's gate admits (ADR-0058). A friend learns
// that they are in voice somewhere else; a crew-mate who is not a friend
// learns nothing about a channel they may not enter. The crews in common are
// the ones where both may enter a channel: the owner's crew counts, a crew
// that banned the viewer does not. Ordered: each step is the state the one
// before left behind.
func TestThePageNamesOnlyAChannelTheViewerMayEnter(t *testing.T) {
	h := setup(t)
	alice, bob, cara, dan := h.users.ByToken["alice"].ID, h.users.ByToken["bob"].ID, h.users.ByToken["cara"].ID, h.users.ByToken["dan"].ID
	crew := testx.Crew(t, h.store, "Gate Crew", cara, alice, bob, dan)
	openRoad := testx.Voice(t, h.store, crew, "Open Road", false)
	backRoom := testx.Voice(t, h.store, crew, "Back Room", true, bob, dan)
	h.befriend(t, "alice", "dan")

	presenceOf := func(t *testing.T, rider string) map[string]any {
		t.Helper()
		code, body := h.get(t, "alice", "/api/riders/"+h.id(rider))
		if code != http.StatusOK {
			t.Fatalf("%s's page: %d %v", rider, code, body)
		}
		p, _ := body["presence"].(map[string]any)
		return p
	}
	crewsOf := func(t *testing.T, rider string) []any {
		t.Helper()
		_, body := h.get(t, "alice", "/api/riders/"+h.id(rider))
		crews, _ := body["crewsInCommon"].([]any)
		return crews
	}
	put := func(rider, channel string, riding bool) {
		h.presence.where[h.id(rider)] = channel
		h.presence.riding[channel] = nil
		if riding {
			h.presence.riding[channel] = []string{h.id(rider)}
		}
	}
	want := func(t *testing.T, p map[string]any, online, inVoice, riding bool, channel string) {
		t.Helper()
		place, _ := p["channel"].(map[string]any)
		if p["online"] != online || p["inVoice"] != inVoice || p["riding"] != riding {
			t.Fatalf("presence %v, want online %v inVoice %v riding %v", p, online, inVoice, riding)
		}
		if channel == "" {
			if p["channel"] != nil {
				t.Fatalf("the channel is named past its gate: %v", p)
			}
			return
		}
		if place["channelId"] != channel || place["crewId"] != store.UUIDString(crew) || place["crewName"] != "Gate Crew" {
			t.Fatalf("presence %v, want channel %s of Gate Crew", p, channel)
		}
	}

	t.Run("a friend in an open channel of the crew", func(t *testing.T) {
		put("dan", openRoad, true)
		p := presenceOf(t, "dan")
		want(t, p, true, true, true, openRoad)
		if place, _ := p["channel"].(map[string]any); place["channelName"] != "Open Road" {
			t.Fatalf("the channel's name: %v", p)
		}
	})
	t.Run("a friend in a private channel nobody named alice into", func(t *testing.T) {
		put("dan", backRoom, true)
		want(t, presenceOf(t, "dan"), true, true, false, "")
	})
	t.Run("a crew-mate in that private channel", func(t *testing.T) {
		put("bob", backRoom, true)
		want(t, presenceOf(t, "bob"), false, false, false, "")
	})
	t.Run("a crew-mate in the open channel", func(t *testing.T) {
		put("bob", openRoad, false)
		want(t, presenceOf(t, "bob"), true, true, false, openRoad)
	})
	t.Run("a friend offline", func(t *testing.T) {
		delete(h.presence.where, h.id("dan"))
		want(t, presenceOf(t, "dan"), false, false, false, "")
	})
	t.Run("the crew in common, and its owner's", func(t *testing.T) {
		for _, rider := range []string{"bob", "cara"} {
			crews := crewsOf(t, rider)
			var only map[string]any
			if len(crews) == 1 {
				only, _ = crews[0].(map[string]any)
			}
			if only["name"] != "Gate Crew" {
				t.Fatalf("%s's crews in common: %v", rider, crews)
			}
		}
	})
	t.Run("a friend in the open channel of a crew that banned alice", func(t *testing.T) {
		if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{CrewID: crew, UserID: alice, Role: "banned"}); err != nil {
			t.Fatalf("ban alice: %v", err)
		}
		put("dan", openRoad, true)
		want(t, presenceOf(t, "dan"), true, true, false, "")
		if crews := crewsOf(t, "dan"); len(crews) != 0 {
			t.Fatalf("a crew that banned alice is still in common: %v", crews)
		}
	})
}

func TestSelfSeesOwnPage(t *testing.T) {
	h := setup(t)
	h.ride(t, "alice", crewFixture{}, 100, true)
	_, body := h.get(t, "alice", "/api/riders/"+h.id("alice"))
	if body["friend"] != "self" || body["canAdd"] != false {
		t.Fatalf("self: %v", body)
	}
	if shared, _ := body["sharedRides"].([]any); len(shared) != 1 {
		t.Fatalf("own shared rides: %v", body["sharedRides"])
	}
}

// A rider's page is the page ABOUT their level, and it read sum(rides.xp) —
// so every XP the ledger paid for lounge time, voice sessions and achievements
// (#467) was missing there while the sidebar, the room and DM heads showed it.
// One rider, two numbers, and the profile was the one that looked wrong (#690).
func TestProfileXpCountsTheLedgerNotJustRides(t *testing.T) {
	h := setup(t)
	ledger := h.crew(t, "ledger", "alice", "bob")
	h.ride(t, "bob", ledger, 400, false)
	if _, err := h.store.Queries.AddXpEvent(t.Context(), db.AddXpEventParams{
		UserID: h.users.ByToken["bob"].ID,
		Source: "lounge",
		Amount: 180,
		Ref:    "test-bucket",
		At:     pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("xp event: %v", err)
	}

	status, body := h.get(t, "alice", "/api/riders/"+h.id("bob"))
	if status != http.StatusOK {
		t.Fatalf("rider page: %d", status)
	}
	// 400 from the ride plus 180 off the bike — what user_total_xp says, and
	// what every other surface shows for the same rider.
	if body["totalXp"] != float64(580) {
		t.Fatalf("totalXp = %v, want 580 (400 ride + 180 ledger)", body["totalXp"])
	}
}

// The rider page's month is bucketed in the rider's own zone, and the zone
// comes out of a column any client can write (POST /api/me/timezone validates
// with time.LoadLocation). LoadLocation accepts "Local", Postgres does not
// know that name at all, and the page 500'd — so stats.ZoneName refuses it.
// Swap it back for `*rider.Timezone` and this returns 500 with an empty body.
func TestRiderMonthSurvivesAZoneNamePostgresRefuses(t *testing.T) {
	h := setup(t)
	h.befriend(t, "alice", "dan")
	h.ride(t, "dan", crewFixture{}, 250, false)

	for _, tz := range []string{"Local", "Europe/Zurich"} {
		t.Run(tz, func(t *testing.T) {
			dan := h.users.ByToken["dan"]
			if err := h.store.Queries.UpdateUserTimezone(t.Context(), db.UpdateUserTimezoneParams{
				ID: dan.ID, Timezone: &tz,
			}); err != nil {
				t.Fatal(err)
			}
			code, body := h.get(t, "alice", "/api/riders/"+h.id("dan"))
			if code != http.StatusOK {
				t.Fatalf("got %d %v", code, body)
			}
			month, _ := body["month"].(map[string]any)
			if month["rides"] != float64(1) {
				t.Fatalf("month: %v", month)
			}
		})
	}
}

// ADR-0055: a shared ride shows a friend what the trainer recorded, never
// what the rider wrote about it. The projection this page reads names its
// columns, so the guard is that nobody adds them to it — which is exactly
// the change this test would fail on.
func TestAFriendsPageNeverCarriesTheRidersOwnWords(t *testing.T) {
	h := setup(t)
	h.befriend(t, "alice", "dan")
	ride := h.ride(t, "dan", crewFixture{}, 300, true)
	const written = "legs were dead, third day on"
	if _, err := h.store.Pool.Exec(t.Context(),
		"update rides set rpe = 9, note = $1 where id = $2", written, ride); err != nil {
		t.Fatalf("write feel: %v", err)
	}

	status, body := h.get(t, "alice", "/api/riders/"+h.id("dan"))
	if status != http.StatusOK {
		t.Fatalf("friend's page: %d", status)
	}
	if shared, _ := body["sharedRides"].([]any); len(shared) != 1 {
		t.Fatalf("the ride is shared and should be listed: %v", body["sharedRides"])
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// The whole page, not just the ride: an RPE folded into a summary or a
	// note used as a subtitle would leak it just as thoroughly.
	for _, leak := range []string{written, `"rpe"`, `"note"`} {
		if strings.Contains(string(raw), leak) {
			t.Fatalf("a friend's page carries %s: %s", leak, raw)
		}
	}
}
