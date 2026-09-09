package rooms

// Roles, removal, bans and a rider's own preferences — the tests for
// room_members.go, split out of rooms_test.go (consolidation sweep 2026-09-09).

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func TestRolesMatrix(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Matrix")
	h.join(t, "bob", slug)

	bobID := store.UUIDString(h.users.ByToken["bob"].ID)
	roleBody := fmt.Sprintf(`{"userId":%q,"role":"coach"}`, bobID)

	// Member cannot edit the room or assign roles (SPEC matrix: owner-only).
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug, `{"name":"x","listed":true}`); status != http.StatusForbidden {
		t.Errorf("member edited the room: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/role", roleBody); status != http.StatusForbidden {
		t.Errorf("member assigned a role: %d", status)
	}

	// Owner promotes bob to coach.
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", roleBody); status != http.StatusNoContent {
		t.Errorf("owner could not promote: %d", status)
	}
	// Re-joining must not downgrade the coach back to member.
	h.join(t, "bob", slug)
	_, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if body["role"] != "coach" {
		t.Errorf("re-join downgraded coach to %v", body["role"])
	}

	// Coach still cannot do owner things.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"coach"}`, store.UUIDString(h.users.ByToken["carol"].ID))); status != http.StatusForbidden {
		t.Errorf("coach assigned a role: %d", status)
	}
}

func TestLeaveAndRemove(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Leaving")
	h.join(t, "bob", slug)
	bobID := store.UUIDString(h.users.ByToken["bob"].ID)
	aliceID := store.UUIDString(h.users.ByToken["alice"].ID)

	// A member cannot remove someone else.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+aliceID, ""); status != http.StatusForbidden {
		t.Errorf("member removed another member: %d", status)
	}
	// Self-leave works.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bobID, ""); status != http.StatusNoContent {
		t.Errorf("self-leave: %d", status)
	}
	// The owner cannot leave their own room.
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/members/"+aliceID, ""); status != http.StatusBadRequest {
		t.Errorf("owner left their own room: %d", status)
	}
}

func TestBanFlow(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Ban Cave")
	for _, member := range []string{"bob", "carol"} {
		h.join(t, member, slug)
	}
	bobID := store.UUIDString(h.users.ByToken["bob"].ID)
	ban := fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bobID)

	// Only the owner bans.
	if status, _ := h.call(t, "carol", http.MethodPost, "/api/rooms/"+slug+"/role", ban); status != http.StatusForbidden {
		t.Errorf("member banned someone: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", ban); status != http.StatusNoContent {
		t.Fatalf("ban: %d", status)
	}

	// The ban holds every door: rejoin by link, by code, and the WS/AV gate.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Errorf("banned rejoined by link: %d", status)
	}
	// A room ban is not a crew ban: the crew's door still answers, the
	// room's does not (ADR-0038, third amendment; #1236).
	joinBody := fmt.Sprintf(`{"code":%q}`, code)
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", joinBody); status != http.StatusOK {
		t.Errorf("a room ban shut the crew's door: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Errorf("banned rejoined after re-entering the crew: %d", status)
	}
	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	wsReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+slug, nil)
	wsReq.Header.Set("X-Test-User", "bob")
	if _, _, err := svc.Authorize(wsReq, slug); err == nil {
		t.Error("banned rider authorized for the room socket")
	}
	// Nor is "leaving" a way out (#637): the banned row is the ban, so the
	// self-removal path refuses, the row stays, and the rejoin stays shut.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bobID, ""); status != http.StatusForbidden {
		t.Errorf("banned rider left the room: %d", status)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if _, err := h.store.Queries.DeleteMembership(t.Context(), db.DeleteMembershipParams{
		RoomID: room.ID, UserID: h.users.ByToken["bob"].ID,
	}); err != nil {
		t.Fatalf("delete membership: %v", err)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Errorf("banned rider rejoined after leaving: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/schedule/"+bobID+"/rsvp", ""); status != http.StatusForbidden {
		t.Errorf("banned rider reached the RSVP gate: %d", status)
	}

	// The room vanishes from bob's nav, and bob gets the outsider view.
	if _, body := h.call(t, "bob", http.MethodGet, "/api/rooms", ""); body != nil {
		if roomsAny, _ := body["rooms"].([]any); len(roomsAny) != 0 {
			t.Errorf("banned rider still lists the room: %v", roomsAny)
		}
	}
	if _, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, ""); body["role"] != nil || body["code"] != nil {
		t.Errorf("banned rider got the member view: %v", body)
	}

	// Members don't see the ban list; the owner does.
	countMembers := func(user string) (total, banned int) {
		_, body := h.call(t, user, http.MethodGet, "/api/rooms/"+slug, "")
		members, _ := body["members"].([]any)
		for _, m := range members {
			total++
			if row, ok := m.(map[string]any); ok && row["role"] == "banned" {
				banned++
			}
		}
		return total, banned
	}
	if total, banned := countMembers("carol"); total != 2 || banned != 0 {
		t.Errorf("member view of the roster: %d members, %d banned", total, banned)
	}
	if total, banned := countMembers("alice"); total != 3 || banned != 1 {
		t.Errorf("owner view of the roster: %d members, %d banned", total, banned)
	}

	// Unban restores a plain membership.
	unban := fmt.Sprintf(`{"userId":%q,"role":"member"}`, bobID)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", unban); status != http.StatusNoContent {
		t.Fatalf("unban: %d", status)
	}
	if _, _, err := svc.Authorize(wsReq, slug); err != nil {
		t.Errorf("unbanned rider still refused: %v", err)
	}
}

// The room's member list carries each rider's earned badges (#703): the
// Members place is the one surface ADR-0027 lets a crew compare itself on, and
// it has no other source. Earned keys only — the achievements table holds
// nothing else, so there is no progress here to leak.
func TestMembersCarryEarnedBadges(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Badge Crew")
	h.enter(t, "bob", code, slug)
	for _, key := range []string{"lounge-lizard", "dj"} {
		if _, err := h.store.Queries.AwardAchievement(t.Context(), db.AwardAchievementParams{
			UserID: h.users.ByToken["bob"].ID, Key: key,
			EarnedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		}); err != nil {
			t.Fatalf("award %s: %v", key, err)
		}
	}

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	members, _ := body["members"].([]any)
	var seen []string
	for _, raw := range members {
		m, _ := raw.(map[string]any)
		if m["displayName"] != "bob" {
			// A rider with no badges carries none — omitempty, not an empty list.
			if _, present := m["badges"]; present {
				t.Fatalf("%v carries a badges field with nothing in it", m["displayName"])
			}
			continue
		}
		badges, ok := m["badges"].([]any)
		if !ok {
			t.Fatalf("bob carries no badges field: %v", m)
		}
		for _, b := range badges {
			key, ok := b.(string)
			if !ok {
				t.Fatalf("badge %v is not a key", b)
			}
			seen = append(seen, key)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("bob's badges = %v, want the two he earned", seen)
	}
}

// A rider's own settings for one room (#1100). The switches are the easy
// half; what matters is that the two queries downstream actually honour them,
// because a preference nothing reads is worse than no preference at all —
// the rider believes they are off the board and they are on it.
func TestRiderPrefsAreTheirOwnAndAreHonoured(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Prefs")
	for _, member := range []string{"bob", "carol"} {
		h.join(t, member, slug)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}

	// Defaults reproduce today's behaviour: nobody is opted out by the
	// migration. This is the box that a silent opt-out would fail.
	_, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ := body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Fatalf("defaults are not today's behaviour: %v", body["me"])
	}

	// Bob opts out of both.
	if status, out := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("set prefs: %d %v", status, out)
	}
	_, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ = body["me"].(map[string]any)
	if me == nil || me["notify"] != false || me["onBoard"] != false {
		t.Errorf("preferences did not persist: %v", body["me"])
	}
	// Carol is untouched — one rider's choice is not the room's.
	_, body = h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ = body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Errorf("bob's choice reached carol: %v", body["me"])
	}

	// The mail list honours it. The query needs a deliverable address and the
	// global flag on, so both are set directly — without them the target list
	// is empty whatever the preference says, and the assertion below would
	// pass against a filter that does nothing.
	for _, who := range []string{"bob", "carol"} {
		if _, err := h.store.Pool.Exec(t.Context(),
			"update users set email = $2, email_verified_at = now(), notify_planned = true where id = $1",
			h.users.ByToken[who].ID, who+"@example.test"); err != nil {
			t.Fatalf("give %s an address: %v", who, err)
		}
	}
	// Alice plans, so she is excluded as the planner; bob opted out; carol
	// should be the only target left.
	targets, err := h.store.Queries.ListRoomNotifyTargets(t.Context(), db.ListRoomNotifyTargetsParams{
		RoomID: room.ID, ID: h.users.ByToken["alice"].ID,
	})
	if err != nil {
		t.Fatalf("notify targets: %v", err)
	}
	var mailedBob, mailedCarol bool
	for _, target := range targets {
		mailedBob = mailedBob || target.ID == h.users.ByToken["bob"].ID
		mailedCarol = mailedCarol || target.ID == h.users.ByToken["carol"].ID
	}
	if mailedBob {
		t.Error("a rider who turned this room's mail off was still a target")
	}
	if !mailedCarol {
		t.Error("nobody would be mailed, so the opt-out proves nothing")
	}

	// And the board honours it — proved with a real ride this week, because
	// an empty board proves nothing about a filter.
	for _, who := range []string{"bob", "carol"} {
		h.roomRide(t, who, room.ID, time.Now(), 1800)
	}
	rows, err := h.store.Queries.RoomWeekBoard(t.Context(), room.ID)
	if err != nil {
		t.Fatalf("board: %v", err)
	}
	var sawBob, sawCarol bool
	for _, row := range rows {
		sawBob = sawBob || row.UserID == h.users.ByToken["bob"].ID
		sawCarol = sawCarol || row.UserID == h.users.ByToken["carol"].ID
	}
	if sawBob {
		t.Error("a rider who opted out is on the board anyway")
	}
	if !sawCarol {
		t.Error("nobody is on the board, so the opt-out proves nothing")
	}
}

// The update is keyed on (room, caller), so there is no way to spell another
// rider's preferences — and a non-member is refused by the same gate every
// other room-scoped write uses.
func TestOnlyYouSetYourOwnRoomPrefs(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Not Yours")
	h.join(t, "bob", slug)

	// Carol never joined.
	if status, _ := h.call(t, "carol", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusForbidden {
		t.Errorf("a non-member set preferences: %d", status)
	}
	// Signed out is 401, not 403.
	if status, _ := h.call(t, "", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
	// Bob's own write does not reach alice, however he addresses it: the body
	// carries no user id at all, so a smuggled one is simply refused.
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		fmt.Sprintf(`{"notify":false,"onBoard":false,"userId":%q}`,
			store.UUIDString(h.users.ByToken["alice"].ID))); status != http.StatusBadRequest {
		t.Errorf("a smuggled userId was accepted: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("bob's own write: %d", status)
	}
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ := body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Errorf("bob's write changed alice's preferences: %v", body["me"])
	}
}

// Leaving drops the membership row, so preferences reset on rejoining. That
// falls out of where they live rather than being enforced anywhere, which is
// exactly why it is worth a test — nothing else states it.
func TestLeavingARoomForgetsYourPreferences(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Forgetful")
	bobID := store.UUIDString(h.users.ByToken["bob"].ID)
	h.join(t, "bob", slug)
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("set prefs: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bobID, ""); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	h.join(t, "bob", slug)
	_, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ := body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Errorf("rejoining kept the old preferences: %v", body["me"])
	}
}
