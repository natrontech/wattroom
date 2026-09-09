package rooms

// What a room and the room list say to whom — the tests for room_read.go,
// split out of rooms_test.go (consolidation sweep 2026-09-09).

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The roster carries the level (#690): the room's faces wear the same ring the
// sidebar, the member list and DM heads already showed, and the strip's tiles
// have no other source for it. Authorize is where a socket's rider is built.
func TestAuthorizeCarriesTheRidersLevel(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Ring Room")
	if _, err := h.store.Queries.AddXpEvent(t.Context(), db.AddXpEventParams{
		UserID: h.users.ByToken["alice"].ID,
		Source: "lounge",
		Amount: 240,
		Ref:    "roster-test",
		At:     pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("xp event: %v", err)
	}

	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+slug, nil)
	req.Header.Set("X-Test-User", "alice")
	rider, _, err := svc.Authorize(req, slug)
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if rider.TotalXp != 240 {
		t.Fatalf("rider.TotalXp = %d, want 240 — the roster cannot ring without it", rider.TotalXp)
	}
}

// Authorize hands back the room's canonical slug, whatever casing the link
// carried (#639): the hub and the AV token key live state on that, so a
// mixed-case link cannot fork a second live room.
func TestAuthorizeReturnsTheCanonicalSlug(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Velvet Crew")
	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	shouted := strings.ToUpper(slug)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+shouted, nil)
	req.Header.Set("X-Test-User", "alice")
	_, canonical, err := svc.Authorize(req, shouted)
	if err != nil {
		t.Fatalf("authorize %q: %v", shouted, err)
	}
	if canonical != slug {
		t.Fatalf("canonical slug = %q, want %q", canonical, slug)
	}
}

func TestUnreadBadgeSurvivesANamesake(t *testing.T) {
	// #649: standing in a room is reading it, so the badge is suppressed for
	// whoever is in there. That test used to be by display name, which
	// nothing makes unique: a second rider called "alice" standing in the
	// room silenced the real alice's badge, and the sidebar read as broken.
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "MFW 5")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room by slug: %v", err)
	}
	if _, err := h.store.Queries.SaveChatMessage(t.Context(), db.SaveChatMessageParams{
		RoomID: room.ID, UserID: h.users.ByToken["bob"].ID, Text: "anyone riding tonight?",
	}); err != nil {
		t.Fatalf("save chat: %v", err)
	}

	unreadFor := func(t *testing.T, present protocol.RoomPresence) float64 {
		t.Helper()
		h.svc.SetPresence(fakePresence{p: present})
		status, body := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
		if status != http.StatusOK {
			t.Fatalf("list rooms: %d %v", status, body)
		}
		list, _ := body["rooms"].([]any)
		if len(list) != 1 {
			t.Fatalf("want one room, got %v", body["rooms"])
		}
		entry, _ := list[0].(map[string]any)
		n, _ := entry["unread"].(float64)
		return n
	}

	// A namesake in the room, and alice herself nowhere near it.
	namesake := store.UUIDString(h.users.ByToken["bob"].ID)
	if n := unreadFor(t, protocol.RoomPresence{Riders: []string{"alice"}, RiderIDs: []string{namesake}}); n != 1 {
		t.Errorf("a namesake silenced the badge: unread = %v, want 1", n)
	}
	// Alice herself, standing in it: the badge is hers to lose.
	alice := store.UUIDString(h.users.ByToken["alice"].ID)
	if n := unreadFor(t, protocol.RoomPresence{Riders: []string{"alice"}, RiderIDs: []string{alice}}); n != 0 {
		t.Errorf("alice is standing in the room: unread = %v, want 0", n)
	}
}

// #890 folded four per-room queries into ListUserRooms, two of them as LEFT
// LATERAL joins. A room with nothing planned and nothing said yields NULL for
// both, and sqlc reads their text columns as non-null from the schema — so
// without the coalesce in the query this scan fails and the whole rail 500s
// on the most ordinary room there is: a brand new one.
func TestRoomsListHandlesARoomWithNoPlanAndNoChat(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Fresh Air")

	status, body := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	if status != http.StatusOK {
		t.Fatalf("list rooms: %d %v", status, body)
	}
	list, _ := body["rooms"].([]any)
	if len(list) != 1 {
		t.Fatalf("want one room, got %v", body["rooms"])
	}
	entry, _ := list[0].(map[string]any)
	if entry["slug"] != slug {
		t.Fatalf("slug = %v, want %q", entry["slug"], slug)
	}
	// Absent, not an empty husk: the frontend renders on presence of the key.
	if next, ok := entry["nextSession"]; ok && next != nil {
		t.Errorf("nextSession = %v, want absent for a room with no plan", next)
	}
	if last, ok := entry["lastChat"]; ok && last != nil {
		t.Errorf("lastChat = %v, want absent for a room nobody has spoken in", last)
	}
	// The owner still counts, and the count comes from the same single query.
	if n, _ := entry["memberCount"].(float64); n != 1 {
		t.Errorf("memberCount = %v, want 1", n)
	}
}

func TestTogetherStatsAreCooperativeAndOwn(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Stats Test")
	h.enter(t, "bob", code, slug)
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}

	now := time.Now()
	// Two riders in one session is ONE session, and both their seconds count.
	h.roomRide(t, "alice", room.ID, now.Add(-2*time.Hour), 1800)
	h.roomRide(t, "bob", room.ID, now.Add(-2*time.Hour), 1200)
	// A second session this month, alice only.
	h.roomRide(t, "alice", room.ID, now.AddDate(0, 0, -3), 600)
	// And one last month, so the month-on-month figure has something behind it.
	h.roomRide(t, "bob", room.ID, now.AddDate(0, -1, 0).AddDate(0, 0, -1), 900)

	status, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("get room: %d", status)
	}
	together, ok := body["together"].(map[string]any)
	if !ok {
		t.Fatalf("no together stats: %v", body)
	}
	number := func(field string) float64 {
		t.Helper()
		got, ok := together[field].(float64)
		if !ok {
			t.Fatalf("together.%s is %T, not a number: %v", field, together[field], together)
		}
		return got
	}
	if got := number("seconds"); got != 4500 {
		t.Errorf("seconds together = %v, want 4500 (everyone's, summed)", got)
	}
	// Three rides across two days this month, not three sessions.
	if got := number("sessionsThisMonth"); got != 2 {
		t.Errorf("sessions this month = %v, want 2", got)
	}
	if got := number("sessionsLastMonth"); got != 1 {
		t.Errorf("sessions last month = %v, want 1", got)
	}

	// The strip is the CALLER's own turnout. Bob missed the middle session and
	// alice missed last month's, and each of them sees only their own record.
	attended := func(who string) []bool {
		t.Helper()
		_, body := h.call(t, who, http.MethodGet, "/api/rooms/"+slug, "")
		stats, ok := body["together"].(map[string]any)
		if !ok {
			t.Fatalf("%s sees no together stats: %v", who, body)
		}
		raw, ok := stats["attended"].([]any)
		if !ok {
			t.Fatalf("%s: attended is %T: %v", who, stats["attended"], stats)
		}
		out := make([]bool, len(raw))
		for i, v := range raw {
			here, ok := v.(bool)
			if !ok {
				t.Fatalf("%s: attended[%d] is %T", who, i, v)
			}
			out[i] = here
		}
		return out
	}
	// Oldest first: last month, three days ago, today.
	if got := attended("alice"); len(got) != 3 || got[0] || !got[1] || !got[2] {
		t.Errorf("alice attended = %v, want [false true true]", got)
	}
	if got := attended("bob"); len(got) != 3 || !got[0] || got[1] || !got[2] {
		t.Errorf("bob attended = %v, want [true false true]", got)
	}
}

// Renamed with the field (#1178): what a room did together is `together` now,
// because ADR-0038 took `crew` for the layer above a room. The assertion is
// unchanged — only the key it reads, which is what following a rename means.
func TestTogetherStatsAreMembersOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Together Privacy Test")
	if _, body := h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, ""); body["together"] != nil {
		t.Errorf("a non-member can see what the room did together: %v", body["together"])
	}
	if _, body := h.call(t, "", http.MethodGet, "/api/rooms/"+slug, ""); body["together"] != nil {
		t.Errorf("a signed-out visitor can see what the room did together: %v", body["together"])
	}
}

// The crew rides the room payload so the sidebar can group by it without a
// second request (#1178). Members only, on the same rule as the join code:
// someone outside the room may be outside its crew, and the crew's name is
// then not theirs to read.
func TestTheCrewIsOnTheRoomAndMembersOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Field Test")
	h.putInCrew(t, slug, "Natron")

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	crew, _ := body["crew"].(map[string]any)
	if crew == nil {
		t.Fatalf("a member cannot see the room's crew: %v", body["crew"])
	}
	if crew["name"] != "Natron" {
		t.Errorf("crew name = %v, want Natron", crew["name"])
	}
	if crew["id"] == nil || crew["id"] == "" {
		t.Error("the crew has no id, so a sidebar cannot group by it")
	}

	for _, who := range []struct{ name, as string }{
		{"a non-member", "carol"}, {"a signed-out visitor", ""},
	} {
		if _, body := h.call(t, who.as, http.MethodGet, "/api/rooms/"+slug, ""); body["crew"] != nil {
			t.Errorf("%s can see the room's crew: %v", who.name, body["crew"])
		}
	}
}

// The list is what the sidebar actually reads, and it carries the crew from a
// join rather than a lookup per room — this query's own comment is about the
// 1+4N round trips it already replaced once.
func TestTheRoomListCarriesTheCrew(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew List Test")
	h.putInCrew(t, slug, "Natron")

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	rooms, _ := body["rooms"].([]any)
	for _, entry := range rooms {
		room, _ := entry.(map[string]any)
		if room["slug"] != slug {
			continue
		}
		crew, _ := room["crew"].(map[string]any)
		if crew == nil || crew["name"] != "Natron" {
			t.Fatalf("the room list does not name the room's crew: %v", room["crew"])
		}
		return
	}
	t.Fatal("the room is missing from its owner's list")
}

func TestBoardIsOffUntilTheRoomTurnsItOn(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Board Opt In Test")
	h.enter(t, "bob", code, slug)
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	h.roomRide(t, "alice", room.ID, time.Now(), 3600)
	h.roomRide(t, "bob", room.ID, time.Now(), 1800)

	// Being in a room does not put you on a board (ADR-0036).
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if body["board"] != nil {
		t.Fatalf("a board appeared without anyone enabling it: %v", body["board"])
	}
	if enabled, _ := body["boardEnabled"].(bool); enabled {
		t.Fatalf("boardEnabled is true on a fresh room")
	}

	// A member cannot switch it on; room settings are the owner's (SPEC matrix).
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Board Opt In Test","listed":false,"boardEnabled":true}`); status != http.StatusForbidden {
		t.Errorf("a member turned the board on: %d", status)
	}

	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Board Opt In Test","listed":false,"boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("owner could not enable the board: %d", status)
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	board, ok := body["board"].([]any)
	if !ok || len(board) != 2 {
		t.Fatalf("board = %v, want two riders", body["board"])
	}
	// Ordered by the week's work, and carrying the bracket, not just a rank.
	first, _ := board[0].(map[string]any)
	if first["displayName"] != "alice" {
		t.Errorf("board leader = %v, want alice (more kJ)", first["displayName"])
	}
	if first["category"] == nil || first["category"] == "" {
		t.Errorf("board row carries no category: %v", first)
	}

	// And a rename must not silently switch it back off.
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Renamed","listed":false}`); status != http.StatusOK {
		t.Fatalf("rename")
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if enabled, _ := body["boardEnabled"].(bool); !enabled {
		t.Errorf("a rename turned the board off")
	}
}

func TestBoardIsThisWeekOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Board Week Test")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Board Week Test","listed":false,"boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("enable board")
	}
	// Two weeks ago: a bad week is never permanent, so it must not be counted.
	h.roomRide(t, "alice", room.ID, time.Now().AddDate(0, 0, -14), 3600)

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if body["board"] != nil {
		t.Errorf("last fortnight's ride is on this week's board: %v", body["board"])
	}
}

// The member settings page renders the room's join code (#1099), so the read
// that feeds it must never hand the code to somebody outside the room. This
// is the acceptance box with teeth: the page cannot leak what the API does
// not give it, and it cannot help if the API does.
func TestOnlyMembersReadTheRoomsCode(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Code Guarded")
	if code == "" {
		t.Fatal("no code to guard")
	}

	// A member gets everything the settings page shows — the pack, the
	// reaction set and the roster — and, on the crew, the code they are meant
	// to share (#1236: the invite is the crew's).
	h.join(t, "bob", slug)
	status, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("member read: %d", status)
	}
	if _, crewBody := h.call(t, "bob", http.MethodGet, "/api/crews/"+store.UUIDString(h.crewOf(t, slug).ID), ""); crewBody["code"] != code {
		t.Errorf("a crew member cannot see the code they are meant to share: %v", crewBody["code"])
	}
	if body["members"] == nil {
		t.Error("a member got no roster, so the page cannot say who owns the room")
	}

	// Carol never joined. She may learn the room exists — the slug is a URL —
	// but not the thing that gets her in.
	status, body = h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, "")
	if status == http.StatusOK {
		if body["code"] != nil {
			t.Errorf("a non-member read the join code: %v", body["code"])
		}
		if body["soundPack"] != nil || body["cheers"] != nil || body["icsToken"] != nil {
			t.Errorf("a non-member read members-only settings: %v", body)
		}
		if body["members"] != nil {
			t.Errorf("a non-member read the roster: %v", body["members"])
		}
	}

	// And a banned rider is not a member, however they got here.
	bobID := store.UUIDString(h.users.ByToken["bob"].ID)
	ban := fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bobID)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", ban); status != http.StatusNoContent {
		t.Fatalf("ban: %d", status)
	}
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status == http.StatusOK && body["code"] != nil {
		t.Errorf("a banned rider kept the join code: %v", body["code"])
	}
}
