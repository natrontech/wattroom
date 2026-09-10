package rooms

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// crewOf returns the crew a room was created into.
func (h *harness) crewOf(t *testing.T, slug string) db.GetCrewRow {
	t.Helper()
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if !room.CrewID.Valid {
		t.Fatalf("room %s is crewless", slug)
	}
	crew, err := h.store.Queries.GetCrew(t.Context(), room.CrewID)
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	return crew
}

// makePrivate flips a room to the state every room was migrated into.
func (h *harness) makePrivate(t *testing.T, slug string) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(), "update rooms set crew_visible = false where slug = $1", slug); err != nil {
		t.Fatalf("make private: %v", err)
	}
}

// enter is the front door (#1236): the crew by its code, then the room by
// its address. Asserted to succeed at both.
func (h *harness) enter(t *testing.T, who, code, slug string) {
	t.Helper()
	if status, body := h.call(t, who, http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("%s could not join the crew: %d %v", who, status, body)
	}
	if status, _ := h.call(t, who, http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("%s could not enter %s: %d", who, slug, status)
	}
}

// join enters a room as a crew member would: through the crew's door first.
func (h *harness) join(t *testing.T, who, slug string) {
	t.Helper()
	h.enter(t, who, codeOf(h.crewOf(t, slug).Code), slug)
}

// accessIn reads the access state the room list reports for slug, "" if the
// room is not listed at all. A row the caller may not enter carries no slug
// (#1205), so the row is matched by id as well.
func (h *harness) accessIn(t *testing.T, who, slug string) string {
	t.Helper()
	row := h.listedRow(t, who, slug)
	if row == nil {
		return ""
	}
	access, _ := row["access"].(string)
	return access
}

// listedRow is the room list's row for slug, nil when the caller is not
// handed the room at all.
func (h *harness) listedRow(t *testing.T, who, slug string) map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/rooms", "")
	if status != http.StatusOK {
		t.Fatalf("list rooms: %d", status)
	}
	id := store.UUIDString(roomID(t, h, slug))
	rooms, _ := body["rooms"].([]any)
	for _, entry := range rooms {
		room, _ := entry.(map[string]any)
		if room["slug"] == slug || room["id"] == id {
			return room
		}
	}
	return nil
}

// kickRecorder is the presence hook with a memory: which rooms a crew ban
// severed. fakePresence's other methods ride along.
type kickRecorder struct {
	fakePresence
	kicked []string
}

func (k *kickRecorder) Kick(slug, userID string) { k.kicked = append(k.kicked, slug) }

func TestANewRoomIsMadeInsideItsOwnersCrewAndOpenToIt(t *testing.T) {
	h := setup(t)
	first, _ := h.createRoom(t, "alice", "Crew First Room")
	second, _ := h.createRoom(t, "alice", "Crew Second Room")

	a, b := h.crewOf(t, first), h.crewOf(t, second)
	if a.ID != b.ID {
		t.Errorf("an owner's rooms landed in two crews — the rule is one crew per owner")
	}
	if a.OwnerID != h.users.ByToken["alice"].ID {
		t.Errorf("the crew is not owned by the rider who made the room")
	}
	if a.Name != "alice" {
		t.Errorf("the crew is named %q, want the owner's name as a placeholder", a.Name)
	}
	room, _ := h.store.Queries.GetRoomBySlug(t.Context(), first)
	if !room.CrewVisible {
		t.Errorf("a room made after the cutover is not open to its crew (ADR-0038)")
	}
	// The creation response already says so — the client need not re-fetch.
	_, body := h.call(t, "alice", http.MethodPost, "/api/rooms", `{"name":"Crew Third Room"}`)
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(t.Context(), "delete from rooms where slug = $1", body["slug"])
	})
	crew, _ := body["crew"].(map[string]any)
	if crew["role"] != "owner" {
		t.Errorf("the creation response does not say the rider owns the crew: %v", body["crew"])
	}
}

// The four states #1149 draws, from the two lists the sidebar reads. A crew
// member sees the crew's other rooms without being in them; an admin who
// never joined sees them as administrable; nobody sees a room they are
// banned from.
func TestTheRoomListSaysWhatYouMayDoInEachRoom(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Open Room")
	private, _ := h.createRoom(t, "alice", "Crew Private Room")
	h.makePrivate(t, private)
	crew := h.crewOf(t, open)
	h.join(t, "bob", open)

	cases := []struct {
		name string
		who  string
		slug string
		want string
	}{
		{"the owner in an open room", "alice", open, "open"},
		{"the owner in a private room", "alice", private, "private"},
		{"a member of an open room", "bob", open, "open"},
		{"a crew-mate outside a private room", "bob", private, "locked"},
		{"a stranger", "carol", open, ""},
	}
	for _, c := range cases {
		if got := h.accessIn(t, c.who, c.slug); got != c.want {
			t.Errorf("%s: access %q, want %q", c.name, got, c.want)
		}
	}

	// A named exception turns locked into private-and-you-are-in-it.
	if err := h.store.Queries.GrantRoomAccess(t.Context(), db.GrantRoomAccessParams{
		RoomID: roomID(t, h, private), UserID: h.users.ByToken["bob"].ID,
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if got := h.accessIn(t, "bob", private); got != "private" {
		t.Errorf("a granted rider reads the private room as %q, want private", got)
	}

	// A crew admin who never joined anything: listed, administrable, not
	// enterable — and the owner's own row would look the same (ADR-0038).
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["carol"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	// An admin is in the crew (#1236: a row is membership), so the open room
	// is open to her; the private one she administers without entering.
	if got := h.accessIn(t, "carol", open); got != "open" {
		t.Errorf("a crew admin reads the open room as %q, want open", got)
	}
	if got := h.accessIn(t, "carol", private); got != "admin" {
		t.Errorf("a non-member crew admin reads the private room as %q, want admin", got)
	}

	// A room ban keeps the room off the list entirely, whatever else is true.
	body := fmt.Sprintf(`{"userId":%q,"role":"banned"}`, store.UUIDString(h.users.ByToken["bob"].ID))
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+open+"/role", body); status != http.StatusNoContent {
		t.Fatalf("ban: %d", status)
	}
	if got := h.accessIn(t, "bob", open); got != "" {
		t.Errorf("a room-banned rider is still handed the room as %q", got)
	}
}

// The slug is the door — /r/{slug} joins anyone not banned — so a row the
// caller may not enter must not carry it, on either list that draws one
// (#1205). Before this, "private — you are not in this room" was only the
// client declining to render a link.
func TestARoomYouMayNotEnterKeepsItsSlugToItself(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Door Open")
	private, _ := h.createRoom(t, "alice", "Crew Door Private")
	h.makePrivate(t, private)
	crew := h.crewOf(t, open)
	h.join(t, "bob", open)

	row := h.listedRow(t, "bob", private)
	if row == nil {
		t.Fatal("the private room is not listed to a crew-mate at all")
	}
	if _, leaked := row["slug"]; leaked {
		t.Errorf("the sidebar list hands a crew-mate the locked room's slug: %v", row)
	}
	if row["id"] == "" || row["id"] == nil {
		t.Errorf("the locked row has nothing to be keyed by: %v", row)
	}
	if row := h.listedRow(t, "bob", open); row["slug"] != open {
		t.Errorf("the open room lost its slug: %v", row)
	}

	_, body := h.call(t, "bob", http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID), "")
	rooms, _ := body["rooms"].([]any)
	for _, entry := range rooms {
		room, _ := entry.(map[string]any)
		_, hasSlug := room["slug"]
		switch room["access"] {
		case "locked":
			if hasSlug {
				t.Errorf("the crew page hands a crew-mate the locked room's slug: %v", room)
			}
		case "open":
			if !hasSlug {
				t.Errorf("the crew page's open room lost its slug: %v", room)
			}
		}
	}
	if len(rooms) != 2 {
		t.Errorf("the crew page lists %d rooms, want 2", len(rooms))
	}
}

// The one control ADR-0038's privacy inversion rests on (#1204): the owner
// opens a room to the crew when they mean to, and shuts it again. A
// crew-mate's access follows on the next list, and a PATCH that does not
// mention the field — an older client's rename — keeps what was set.
func TestTheOwnerOpensARoomToTheCrewAndShutsIt(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Ladder Open")
	private, _ := h.createRoom(t, "alice", "Crew Ladder Private")
	h.makePrivate(t, private)
	h.join(t, "bob", open)
	path := "/api/rooms/" + private

	if got := h.accessIn(t, "bob", private); got != "locked" {
		t.Fatalf("before: bob reads %q, want locked", got)
	}
	status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Crew Ladder Private","listed":false,"crewVisible":true}`)
	if status != http.StatusOK || body["crewVisible"] != true {
		t.Fatalf("open to the crew: %d %v", status, body)
	}
	if got := h.accessIn(t, "bob", private); got != "open" {
		t.Errorf("opened: bob reads %q, want open", got)
	}
	// An older client's rename says nothing about the crew and changes nothing.
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Renamed","listed":false}`); status != http.StatusOK || body["crewVisible"] != true {
		t.Errorf("a rename shut the room: %d %v", status, body)
	}
	if status, body := h.call(t, "alice", http.MethodGet, path, ""); status != http.StatusOK || body["crewVisible"] != true {
		t.Errorf("the owner's GET does not say the room is open: %d %v", status, body)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, path, `{"name":"Renamed","listed":false,"crewVisible":false}`); status != http.StatusOK {
		t.Fatalf("shut: %d", status)
	}
	if got := h.accessIn(t, "bob", private); got != "locked" {
		t.Errorf("shut: bob reads %q, want locked", got)
	}
	// A member of the crew, not the room's owner: not theirs to set.
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+open, `{"name":"x","listed":false,"crewVisible":false}`); status != http.StatusForbidden {
		t.Errorf("a member set the crew visibility: %d, want 403", status)
	}
}

// The deliberate hand-over (#1208): owner only, to someone in the crew, and
// the old owner stays on as an admin. The new owner's own role row goes with
// it (#1212) — owner beats every row, and a stale one is a lockout.
func TestTheOwnerHandsTheCrewOn(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Handover")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	path := "/api/crews/" + store.UUIDString(crew.ID) + "/transfer"
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	carol := store.UUIDString(h.users.ByToken["carol"].ID)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}

	if status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusForbidden {
		t.Errorf("an admin handed the crew to themselves: %d, want 403", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, carol)); status != http.StatusBadRequest {
		t.Errorf("the crew passed to someone outside it: %d, want 400", status)
	}
	status, body := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob))
	if status != http.StatusOK || body["role"] != "admin" {
		t.Fatalf("hand-over: %d %v", status, body)
	}
	after, err := h.store.Queries.GetCrew(t.Context(), crew.ID)
	if err != nil || after.OwnerID != h.users.ByToken["bob"].ID {
		t.Fatalf("bob does not own the crew: %v %v", err, after)
	}
	roles, _ := h.store.Queries.ListCrewRoles(t.Context(), crew.ID)
	for _, row := range roles {
		if row.UserID == h.users.ByToken["bob"].ID {
			t.Errorf("the new owner still holds a %s row", row.Role)
		}
		if row.UserID == h.users.ByToken["alice"].ID && row.Role != "admin" {
			t.Errorf("the old owner is %s, want admin", row.Role)
		}
	}
	// And it is bob's to hand on now, not alice's.
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusForbidden {
		t.Errorf("the old owner still hands the crew on: %d, want 403", status)
	}
}

// A room never leaves its crew, so its owner cannot be banned from it
// (#1212): the ban would orphan the room, and SPEC's successor of last resort
// could then be someone the crew banned. The people list says who is exempt
// so the menu withholds the ban instead of offering one that fails.
func TestARoomOwnerCannotBeBannedFromTheCrew(t *testing.T) {
	h := setup(t)
	mine, _ := h.createRoom(t, "alice", "Crew Ban Owner Mine")
	theirs, _ := h.createRoom(t, "bob", "Crew Ban Owner Theirs")
	crew := h.crewOf(t, mine)
	if err := h.store.Queries.PlaceRoomInCrew(t.Context(), db.PlaceRoomInCrewParams{
		ID: roomID(t, h, theirs), CrewID: crew.ID, CrewVisible: true,
	}); err != nil {
		t.Fatalf("place: %v", err)
	}
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	status, _ := h.call(t, "alice", http.MethodPost, "/api/crews/"+store.UUIDString(crew.ID)+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob))
	if status != http.StatusConflict {
		t.Errorf("a room owner was banned from the crew: %d, want 409", status)
	}
	_, body := h.call(t, "alice", http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID), "")
	people, _ := body["people"].([]any)
	for _, entry := range people {
		p, _ := entry.(map[string]any)
		if p["id"] == bob && p["ownsRoom"] != true {
			t.Errorf("the people list does not say bob owns a room here: %v", p)
		}
	}
	// Succession clears the successor's row too: bob, an admin, inherits
	// when alice leaves for good (the purge path), and inherits clean.
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	if err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	if roles, _ := h.store.Queries.ListCrewRoles(t.Context(), crew.ID); len(roles) != 0 {
		t.Errorf("the successor inherited with a role row still on them: %v", roles)
	}
}

// A room opened in a crew you administer lands there and is open to it
// (#1201) — so a group's second room is not only its founder's to make. A
// plain member is refused rather than redirected to their own crew.
func TestAnAdminOpensARoomInSomeoneElsesCrew(t *testing.T) {
	h := setup(t)
	first, _ := h.createRoom(t, "alice", "Crew Second Room Seed")
	crew := h.crewOf(t, first)
	h.join(t, "bob", first)
	h.join(t, "carol", first)
	body := fmt.Sprintf(`{"name":"Crew Games Night","crewId":%q}`, store.UUIDString(crew.ID))

	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms", body); status != http.StatusForbidden {
		t.Fatalf("a member opened a room in the crew: %d, want 403", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms", `{"name":"x","crewId":"not-a-crew"}`); status != http.StatusBadRequest {
		t.Errorf("a garbage crew id: %d, want 400", status)
	}
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	status, created := h.call(t, "bob", http.MethodPost, "/api/rooms", body)
	if status != http.StatusCreated {
		t.Fatalf("an admin could not open a room in the crew: %d %v", status, created)
	}
	slug, _ := created["slug"].(string)
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(t.Context(), "delete from rooms where slug = $1", slug) })
	if c, _ := created["crew"].(map[string]any); c["id"] != store.UUIDString(crew.ID) || c["role"] != "admin" {
		t.Errorf("the room landed in %v, want alice's crew with bob as admin", created["crew"])
	}
	if h.crewOf(t, slug).ID != crew.ID {
		t.Errorf("the room's crew_id is not alice's crew")
	}
	if got := h.accessIn(t, "carol", slug); got != "open" {
		t.Errorf("a crew-mate reads the new room as %q, want open", got)
	}
	if got := h.accessIn(t, "bob", slug); got != "open" {
		t.Errorf("its owner reads the new room as %q, want open", got)
	}
}

// The door (#1236) knows its own: a member following the crew's link again
// is told they are in and handed the way in; a stranger is not handed the
// crew's id, which is not theirs to know until they join.
func TestTheCrewDoorKnowsWhoIsAlreadyIn(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Door Knows")
	crew := h.crewOf(t, slug)
	_, stranger := h.call(t, "bob", http.MethodGet, "/api/crew-doors/"+code, "")
	if stranger["inCrew"] != nil || stranger["id"] != nil {
		t.Errorf("a stranger at the door learned more than the name: %v", stranger)
	}
	_, owner := h.call(t, "alice", http.MethodGet, "/api/crew-doors/"+code, "")
	if owner["inCrew"] != true || owner["id"] != store.UUIDString(crew.ID) {
		t.Errorf("the owner at their own door is not told they are in: %v", owner)
	}
	// Signed out (#1677): the name, the icon, the count and the image — and
	// nothing that is only a member's to know.
	status, anon := h.call(t, "", http.MethodGet, "/api/crew-doors/"+code, "")
	if status != http.StatusOK {
		t.Fatalf("the door signed out: %d", status)
	}
	for _, key := range []string{"id", "inCrew", "banned", "code", "rooms", "people"} {
		if _, has := anon[key]; has {
			t.Errorf("the door hands a signed-out caller %q: %v", key, anon)
		}
	}
	if anon["name"] == nil || anon["members"] == nil {
		t.Errorf("the door withholds the name or the count signed out: %v", anon)
	}
	if status, _ := h.call(t, "", http.MethodGet, "/api/crew-doors/ZZZZZZ", ""); status != http.StatusNotFound {
		t.Errorf("an unknown code: %d, want 404", status)
	}
}

func roomID(t *testing.T, h *harness, slug string) pgtype.UUID {
	t.Helper()
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	return room.ID
}

func TestRenamingTheCrewIsForItsOwnerAndAdmins(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Rename Room")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	path := "/api/crews/" + store.UUIDString(crew.ID)

	if status, _ := h.call(t, "", http.MethodPatch, path, `{"name":"Natron"}`); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPatch, path, `{"name":"Natron"}`); status != http.StatusNotFound {
		t.Errorf("an outsider renamed the crew, or learned it exists: %d, want 404", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPatch, path, `{"name":"Natron"}`); status != http.StatusForbidden {
		t.Errorf("a plain member renamed the crew: %d, want 403", status)
	}
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":""}`); status != http.StatusBadRequest || body["field"] != "name" {
		t.Errorf("an empty name: %d %v, want 400 on name", status, body)
	}
	status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Natron","icon":"zap"}`)
	if status != http.StatusOK || body["name"] != "Natron" || body["icon"] != "zap" {
		t.Fatalf("owner rename: %d %v", status, body)
	}
	if got := h.accessIn(t, "bob", slug); got == "" {
		t.Fatal("bob lost the room")
	}
	_, list := h.call(t, "bob", http.MethodGet, "/api/rooms", "")
	rooms, _ := list["rooms"].([]any)
	room, _ := rooms[0].(map[string]any)
	if c, _ := room["crew"].(map[string]any); c["name"] != "Natron" || c["code"] != codeOf(crew.Code) {
		t.Errorf("the room list's crew does not carry the rename and the code: %v", room["crew"])
	}
}

func TestTheCrewPageShowsItsPeopleAndItsBansToAdminsOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Page Room")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	h.join(t, "carol", slug)
	path := "/api/crews/" + store.UUIDString(crew.ID)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["carol"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("ban: %v", err)
	}

	status, body := h.call(t, "bob", http.MethodGet, path, "")
	if status != http.StatusOK {
		t.Fatalf("member get: %d", status)
	}
	if body["role"] != "member" {
		t.Errorf("bob's role: %v", body["role"])
	}
	people, _ := body["people"].([]any)
	names := []string{}
	for _, p := range people {
		person, _ := p.(map[string]any)
		names = append(names, fmt.Sprint(person["displayName"], ":", person["role"]))
	}
	if !slices.Equal(names, []string{"alice:owner", "bob:member"}) {
		t.Errorf("people: %v — the owner first, the banned rider absent", names)
	}
	if body["banned"] != nil {
		t.Errorf("a plain member was shown the ban list: %v", body["banned"])
	}

	_, body = h.call(t, "alice", http.MethodGet, path, "")
	banned, _ := body["banned"].([]any)
	if len(banned) != 1 {
		t.Fatalf("the owner sees %d banned, want 1", len(banned))
	}
	if status, _ := h.call(t, "carol", http.MethodGet, path, ""); status != http.StatusNotFound {
		t.Errorf("a crew-banned rider can still read the crew: %d", status)
	}
}

// Person-visibility follows the rooms you may enter (#1135), on the crew page
// too: a member sees the crew-mates they share an enterable room with, and
// not the members of a private room they are outside of. The owner, who acts
// on people by id, sees everyone.
func TestTheCrewPageShowsAMemberOnlyThePeopleTheyCouldAlreadySee(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew People Open Room")
	private, _ := h.createRoom(t, "alice", "Crew People Private Room")
	h.makePrivate(t, private)
	h.join(t, "bob", open)
	// carol is let into the private room (#1225): the crew's door, then the
	// named exception, then the room.
	if status, _ := h.call(t, "carol", http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, codeOf(h.crewOf(t, open).Code))); status != http.StatusOK {
		t.Fatalf("carol could not join the crew: %d", status)
	}
	if err := h.store.Queries.GrantRoomAccess(t.Context(), db.GrantRoomAccessParams{RoomID: roomID(t, h, private), UserID: h.users.ByToken["carol"].ID}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if status, _ := h.call(t, "carol", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("carol could not enter the private room she was let into: %d", status)
	}
	path := "/api/crews/" + store.UUIDString(h.crewOf(t, open).ID)

	names := func(who string) []string {
		_, body := h.call(t, who, http.MethodGet, path, "")
		people, _ := body["people"].([]any)
		out := []string{}
		for _, p := range people {
			person, _ := p.(map[string]any)
			out = append(out, fmt.Sprint(person["displayName"]))
		}
		return out
	}
	if got := names("bob"); !slices.Equal(got, []string{"alice", "bob"}) {
		t.Errorf("bob sees %v — carol is in a private room he cannot enter", got)
	}
	if got := names("alice"); !slices.Equal(got, []string{"alice", "bob", "carol"}) {
		t.Errorf("the owner sees %v, want the whole crew", got)
	}
}

// ADR-0038's third amendment, enforced at the API: a crew ban severs every
// room in the crew on the spot, and lifting a ban at one level leaves the
// other standing. Both halves over-permit silently if they regress, so this
// is the mutation-checked one (#1150).
func TestLiftingOneBanLeavesTheOtherStanding(t *testing.T) {
	h := setup(t)
	kicks := &kickRecorder{}
	h.svc.SetPresence(kicks)
	first, _ := h.createRoom(t, "alice", "Crew Ban Room One")
	second, _ := h.createRoom(t, "alice", "Crew Ban Room Two")
	crew := h.crewOf(t, first)
	h.join(t, "bob", first)
	h.join(t, "bob", second)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	crewPath := "/api/crews/" + store.UUIDString(crew.ID) + "/role"

	// Room ban in the first room, then a crew ban over both.
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+first+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("room ban: %d", status)
	}
	kicks.kicked = nil
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath,
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("crew ban: %d", status)
	}
	slices.Sort(kicks.kicked)
	want := []string{first, second}
	slices.Sort(want)
	if !slices.Equal(kicks.kicked, want) {
		t.Errorf("a crew ban severed %v, want every room in the crew %v", kicks.kicked, want)
	}
	for _, slug := range []string{first, second} {
		if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
			t.Errorf("crew-banned bob rejoined %s: %d", slug, status)
		}
	}

	// Lift the CREW ban: the second room opens, the first stays shut on its
	// own ban.
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath,
		fmt.Sprintf(`{"userId":%q,"role":"member"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("crew unban: %d", status)
	}
	// Lifting the ban restores membership (ADR-0038): bob is back on the
	// crew's page, not merely allowed to knock on its rooms.
	if status, body := h.call(t, "bob", http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID), ""); status != http.StatusOK || body["role"] != "member" {
		t.Errorf("after the crew unban bob is not a member of the crew: %d %v", status, body["role"])
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+second+"/join", ""); status != http.StatusNoContent {
		t.Errorf("lifting the crew ban did not readmit bob to a room with no ban of its own: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+first+"/join", ""); status != http.StatusForbidden {
		t.Errorf("lifting the crew ban lifted the room ban too: %d", status)
	}

	// The other way round: crew-ban again, lift the ROOM ban, still shut.
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath,
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("crew ban again: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+first+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"member"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("room unban: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+first+"/join", ""); status != http.StatusForbidden {
		t.Errorf("lifting the room ban readmitted a crew-banned rider: %d", status)
	}
}

func TestDemotingAnAdminLeavesThemAMember(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Demote Room")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	crewPath := "/api/crews/" + store.UUIDString(crew.ID) + "/role"
	for _, role := range []string{"admin", "member"} {
		if status, _ := h.call(t, "alice", http.MethodPost, crewPath, fmt.Sprintf(`{"userId":%q,"role":%q}`, bob, role)); status != http.StatusNoContent {
			t.Fatalf("set %s: %d", role, status)
		}
		// Membership is a row (#1236): "member" is written, not cleared, or
		// the demotion ejects them from the crew.
		if status, body := h.call(t, "bob", http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID), ""); status != http.StatusOK || body["role"] != role {
			t.Errorf("made %s, bob sees the crew as %d %v", role, status, body["role"])
		}
	}
}

func TestTheCrewOwnerIsNeverATarget(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Owner Room")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	alice := store.UUIDString(h.users.ByToken["alice"].ID)
	path := "/api/crews/" + store.UUIDString(crew.ID) + "/role"
	for _, role := range []string{"banned", "member", "admin"} {
		status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q,"role":%q}`, alice, role))
		if status != http.StatusBadRequest {
			t.Errorf("an admin set the owner to %s: %d", role, status)
		}
	}
	// And a plain member acts on nobody.
	h.join(t, "carol", slug)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	if status, _ := h.call(t, "carol", http.MethodPost, path, fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusForbidden {
		t.Errorf("a member banned an admin: %d", status)
	}
}

// The room's own ban list says which banned rows the crew ALSO holds, so the
// owner's Unban can say what it does not reach (#1150). Owner-only, like the
// list itself.
func TestABannedRowSaysWhetherTheCrewBannedThemToo(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Banned Row Room")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	bob := h.users.ByToken["bob"].ID
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, store.UUIDString(bob))); status != http.StatusNoContent {
		t.Fatalf("room ban: %d", status)
	}
	flag := func() any {
		_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
		members, _ := body["members"].([]any)
		for _, m := range members {
			member, _ := m.(map[string]any)
			if member["id"] == store.UUIDString(bob) {
				return member["crewBanned"]
			}
		}
		t.Fatal("bob's banned row is missing from the owner's list")
		return nil
	}
	if flag() != nil {
		t.Errorf("a room-only ban reads as crew-banned")
	}
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{CrewID: crew.ID, UserID: bob, Role: "banned"}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if flag() != true {
		t.Errorf("a row banned at both levels does not say so")
	}
}

// ADR-0038's second amendment: a crew is never left ownerless. Deleting the
// last room deletes the crew; an owner who no longer stands in any of its
// rooms hands it to docs/SPEC.md's successor.
func TestACrewOutlivesItsRoomsAndPassesOnWithItsOwner(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Last Room")
	crew := h.crewOf(t, slug)
	h.enter(t, "bob", code, slug)

	// A crew with no rooms left is still a crew (#1236): its people stay, and
	// its owner opens the next room in it.
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if _, err := h.store.Queries.GetCrew(t.Context(), crew.ID); err != nil {
		t.Fatalf("a crew with no rooms left was deleted: %v", err)
	}
	if role, _ := h.store.Queries.CrewRoleOf(t.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: h.users.ByToken["bob"].ID}); role != "member" {
		t.Errorf("bob's standing went with the room: %q, want member", role)
	}
	// And the client still hears of it (#1476): the room list carries the
	// crews in their own right, so a crew with no rooms keeps its sidebar
	// row, its code, its people and its Leave.
	for _, who := range []string{"alice", "bob"} {
		_, body := h.call(t, who, http.MethodGet, "/api/rooms", "")
		crews, _ := body["crews"].([]any)
		found := false
		for _, c := range crews {
			if row, ok := c.(map[string]any); ok && row["id"] == store.UUIDString(crew.ID) {
				found = true
				if want := map[string]string{"alice": "owner", "bob": "member"}[who]; row["role"] != want {
					t.Errorf("%s's role in the roomless crew reads %v, want %s", who, row["role"], want)
				}
			}
		}
		if !found {
			t.Errorf("%s's room list lost the crew with its last room: %v", who, body["crews"])
		}
	}

	// The owner leaving for good — the purge path — hands it to the
	// longest-standing member (docs/SPEC.md), never leaving it ownerless.
	if err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	after, err := h.store.Queries.GetCrew(t.Context(), crew.ID)
	if err != nil {
		t.Fatalf("the crew was deleted while bob still stood in it: %v", err)
	}
	if after.OwnerID != h.users.ByToken["bob"].ID {
		t.Errorf("the crew passed to %s, want bob", store.UUIDString(after.OwnerID))
	}
	// And with nobody left to own it, it goes.
	if err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["bob"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, err := h.store.Queries.GetCrew(t.Context(), crew.ID); err == nil {
		t.Errorf("a crew with nobody in it survived")
	}
}

// A friend code in the crew box (#1317's mirror): still a 404, but the words
// send the rider to Friends, not back to whoever shared a crew's code.
func TestJoinCrewNamesAFriendCodeForWhatItIs(t *testing.T) {
	h := setup(t)
	status, body := h.call(t, "carol", http.MethodPost, "/api/crews/join", `{"code":"ABCDEFGH"}`)
	if msg, _ := body["message"].(string); status != http.StatusNotFound || !strings.Contains(msg, "friend") {
		t.Fatalf("friend-shaped code: %d %v, want 404 naming the friend code", status, body)
	}
	if status, body := h.call(t, "carol", http.MethodPost, "/api/crews/join", `{"code":"ZZZZZZ"}`); status != http.StatusNotFound || strings.Contains(fmt.Sprint(body["message"]), "friend") {
		t.Fatalf("crew-shaped miss: %d %v, want the plain 404", status, body)
	}
}

// onRoster reads the room's page as its owner and says whether userID is on
// the members list.
func (h *harness) onRoster(t *testing.T, slug, userID string) bool {
	t.Helper()
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	members, _ := body["members"].([]any)
	for _, m := range members {
		if row, ok := m.(map[string]any); ok && row["id"] == userID {
			return true
		}
	}
	return false
}

// Joining is the one way in (ADR-0038 amended): a crew role is for someone
// already in the crew. The role endpoint's upsert used to admit anyone an
// admin named by user id (audit 2026-09-09); a ban stays pre-emptive.
func TestACrewRoleIsForSomeoneAlreadyIn(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Role Stranger")
	crew := h.crewOf(t, slug)
	crewID := store.UUIDString(crew.ID)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	for _, role := range []string{"member", "admin"} {
		status, body := h.call(t, "alice", http.MethodPost, "/api/crews/"+crewID+"/role", fmt.Sprintf(`{"userId":%q,"role":%q}`, bob, role))
		if status != http.StatusBadRequest || body["field"] != "userId" {
			t.Errorf("a stranger was made %s: %d %v", role, status, body)
		}
	}
	if status, _ := h.call(t, "bob", http.MethodGet, "/api/crews/"+crewID, ""); status != http.StatusNotFound {
		t.Errorf("bob reads the crew after the refusals: %d", status)
	}
	// Keeping someone out is not letting them in.
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/crews/"+crewID+"/role", fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("pre-emptive ban: %d", status)
	}
	_, door := h.call(t, "bob", http.MethodGet, "/api/crew-doors/"+code, "")
	if door["banned"] != true || door["id"] != nil {
		t.Errorf("the door does not tell a banned rider so: %v", door)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusForbidden {
		t.Errorf("a pre-emptive ban did not hold at the code: %d", status)
	}
}

// A crew ban removes a person from every room in the crew (ADR-0038, third
// amendment) — the rows too: left behind they stayed on every roster, and
// lifting the ban handed every room back (audit 2026-09-09).
func TestACrewBanTakesTheRoomMembershipsWithIt(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Ban Roster")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	crewPath := "/api/crews/" + store.UUIDString(crew.ID) + "/role"
	if !h.onRoster(t, slug, bob) {
		t.Fatal("bob never made the roster")
	}
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath, fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("crew ban: %d", status)
	}
	if h.onRoster(t, slug, bob) {
		t.Error("a crew-banned rider is still on the room's roster")
	}
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath, fmt.Sprintf(`{"userId":%q,"role":"member"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("crew unban: %d", status)
	}
	// Lifting the ban restores plain crew membership, not the rooms.
	if h.onRoster(t, slug, bob) {
		t.Error("lifting the crew ban put the rider back in the room")
	}
	_, door := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if door["role"] != nil || door["inCrew"] != true {
		t.Errorf("after the unban bob's door reads %v, want in the crew and outside the room", door)
	}
}

// Naming the crew is the server's word (#1151, audit 2026-09-09): a rename
// sets it, an icon pick with the same name does not, and the owner renaming
// THEMSELVES changes nothing — the client used to compare the two names.
func TestACrewIsNamedByRenamingIt(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Named Room")
	crew := h.crewOf(t, slug)
	crewID := store.UUIDString(crew.ID)
	named := func() any {
		_, body := h.call(t, "alice", http.MethodGet, "/api/crews/"+crewID, "")
		return body["named"]
	}
	if named() != false {
		t.Fatalf("a fresh crew reads as named: %v", named())
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/crews/"+crewID, fmt.Sprintf(`{"name":%q,"icon":"flame"}`, crew.Name)); status != http.StatusOK {
		t.Fatalf("icon pick: %d", status)
	}
	if named() != false {
		t.Errorf("an icon pick with the same name counted as naming it")
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/crews/"+crewID, `{"name":"Wadlichlepfer"}`); status != http.StatusOK {
		t.Fatalf("rename: %d", status)
	}
	if named() != true {
		t.Errorf("a rename did not name the crew")
	}
	_, list := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	crews, _ := list["crews"].([]any)
	for _, c := range crews {
		if row, ok := c.(map[string]any); ok && row["id"] == crewID && row["named"] != true {
			t.Errorf("the room list's crew row does not say it is named: %v", row)
		}
	}
}

func TestJoiningTheCrewAnswersMember(t *testing.T) {
	h := setup(t)
	_, code := h.createRoom(t, "alice", "Crew Join Answers")
	status, body := h.call(t, "bob", http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, code))
	if status != http.StatusOK || body["role"] != "member" {
		t.Errorf("a fresh join answered %d %v, want member", status, body["role"])
	}
}

// The day someone joined is theirs to keep: promoting or unbanning them used
// to restamp it, which also made the founding member the newest for
// succession (audit 2026-09-09). And the crew's size is the crew's, not the
// visible list's.
func TestARoleChangeKeepsTheJoinDate(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Since")
	crew := h.crewOf(t, slug)
	crewID := store.UUIDString(crew.ID)
	h.join(t, "bob", slug)
	bobID := h.users.ByToken["bob"].ID
	if _, err := h.store.Pool.Exec(t.Context(),
		"update crew_roles set joined_at = '2026-01-15', set_at = '2026-01-15' where crew_id = $1 and user_id = $2", crew.ID, bobID); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	bob := store.UUIDString(bobID)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/crews/"+crewID+"/role", fmt.Sprintf(`{"userId":%q,"role":"admin"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("promote: %d", status)
	}
	_, body := h.call(t, "alice", http.MethodGet, "/api/crews/"+crewID, "")
	people, _ := body["people"].([]any)
	for _, p := range people {
		if row, ok := p.(map[string]any); ok && row["id"] == bob && row["since"] != "2026-01-15" {
			t.Errorf("promotion restamped bob's since to %v", row["since"])
		}
	}
	if body["members"] != float64(2) {
		t.Errorf("members = %v, want 2", body["members"])
	}
}

// Leaving (#1228): the owner is refused, and for everyone else the crew row
// and every room membership in the crew go in one move, with the sockets.
// Nothing covered the endpoint (audit 2026-09-09).
func TestLeavingTheCrew(t *testing.T) {
	h := setup(t)
	kicks := &kickRecorder{}
	h.svc.SetPresence(kicks)
	first, _ := h.createRoom(t, "alice", "Crew Leave One")
	second, _ := h.createRoom(t, "alice", "Crew Leave Two")
	crewID := store.UUIDString(h.crewOf(t, first).ID)
	h.join(t, "bob", first)
	h.join(t, "bob", second)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/crews/"+crewID+"/leave", ""); status != http.StatusBadRequest {
		t.Errorf("the owner left: %d", status)
	}
	kicks.kicked = nil
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/"+crewID+"/leave", ""); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	slices.Sort(kicks.kicked)
	want := []string{first, second}
	slices.Sort(want)
	if !slices.Equal(kicks.kicked, want) {
		t.Errorf("leaving severed %v, want %v", kicks.kicked, want)
	}
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	for _, slug := range []string{first, second} {
		if h.onRoster(t, slug, bob) {
			t.Errorf("bob is still on %s's roster", slug)
		}
	}
	if status, _ := h.call(t, "bob", http.MethodGet, "/api/crews/"+crewID, ""); status != http.StatusNotFound {
		t.Errorf("bob still reads the crew: %d", status)
	}
}

// A room never leaves its crew, so neither can its owner (#1227).
func TestARoomOwnerCannotLeaveTheCrew(t *testing.T) {
	h := setup(t)
	mine, _ := h.createRoom(t, "alice", "Crew Leave Owner Mine")
	theirs, _ := h.createRoom(t, "bob", "Crew Leave Owner Theirs")
	crew := h.crewOf(t, mine)
	if err := h.store.Queries.PlaceRoomInCrew(t.Context(), db.PlaceRoomInCrewParams{
		ID: roomID(t, h, theirs), CrewID: crew.ID, CrewVisible: true,
	}); err != nil {
		t.Fatalf("place: %v", err)
	}
	h.join(t, "bob", mine)
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/"+store.UUIDString(crew.ID)+"/leave", ""); status != http.StatusConflict {
		t.Errorf("a room owner left the crew: %d", status)
	}
}

// A room shut to its crew leaves the directory with it (#1671): listed and
// crew_visible were independent columns, and the join admitted a stranger
// through the listing after the crew page had made the room private.
func TestShuttingARoomToTheCrewUnlistsIt(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Shut Listed")
	path := "/api/rooms/" + slug
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Crew Shut Listed","listed":true,"crewVisible":true}`); status != http.StatusOK || body["listed"] != true {
		t.Fatalf("list: %d %v", status, body)
	}
	if !inDirectory(t, h, slug) {
		t.Fatal("a listed room is not in the directory — test proves nothing")
	}
	crew := h.crewOf(t, slug)
	access := "/api/crews/" + store.UUIDString(crew.ID) + "/rooms/" + store.UUIDString(roomID(t, h, slug)) + "/access"
	if status, _ := h.call(t, "alice", http.MethodPatch, access, `{"crewVisible":"no"}`); status != http.StatusBadRequest {
		t.Errorf("a malformed access body: %d, want 400", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, access, `{"crewVisible":false}`); status != http.StatusNoContent {
		t.Fatalf("shut from the crew page: %d", status)
	}
	if _, body := h.call(t, "alice", http.MethodGet, path, ""); body["listed"] != false {
		t.Errorf("shut, still listed: %v", body["listed"])
	}
	if inDirectory(t, h, slug) {
		t.Error("a private room is still in the directory")
	}
	if status, _ := h.call(t, "carol", http.MethodPost, path+"/join", ""); status != http.StatusForbidden {
		t.Errorf("a stranger joined a private room: %d, want 403", status)
	}
	// The room's own settings cannot list a private room either.
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Crew Shut Listed","listed":true,"crewVisible":false}`); status != http.StatusOK || body["listed"] != false {
		t.Errorf("listed while shut: %d %v", status, body)
	}
}

// inDirectory says whether the public directory carries the room.
func inDirectory(t *testing.T, h *harness, slug string) bool {
	t.Helper()
	status, body := h.call(t, "carol", http.MethodGet, "/api/rooms/directory", "")
	if status != http.StatusOK {
		t.Fatalf("directory: %d", status)
	}
	for _, v := range body {
		rows, _ := v.([]any)
		for _, row := range rows {
			if m, _ := row.(map[string]any); m["slug"] == slug {
				return true
			}
		}
	}
	return false
}

// The owner holds no role row; a stray one (a listed-room join wrote it,
// #1671) does not list them twice — the page keys its list by id.
func TestAStrayOwnerRowDoesNotListTheOwnerTwice(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Owner Once")
	crew := h.crewOf(t, slug)
	if _, err := h.store.Pool.Exec(t.Context(),
		"insert into crew_roles (crew_id, user_id, role) values ($1, $2, 'member') on conflict do nothing",
		crew.ID, h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("stray row: %v", err)
	}
	_, body := h.call(t, "alice", http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID), "")
	people, _ := body["people"].([]any)
	n := 0
	for _, p := range people {
		if m, _ := p.(map[string]any); m["id"] == h.userID(t, "alice") {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("the owner appears %d times in the people list, want 1: %v", n, people)
	}
}

// The confirm promised it (#1672): leaving the crew, or being banned from it,
// takes the grant into a private room too, and the code does not hand it back.
func TestLeavingOrBeingBannedDropsAPrivateRoomGrant(t *testing.T) {
	h := setup(t)
	open, code := h.createRoom(t, "alice", "Crew Grant Leave Open")
	private, _ := h.createRoom(t, "alice", "Crew Grant Leave Private")
	h.makePrivate(t, private)
	h.join(t, "bob", open)
	bob := h.userID(t, "bob")
	crew := store.UUIDString(h.crewOf(t, open).ID)
	grant := func() {
		t.Helper()
		if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+private+"/grants", fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusNoContent {
			t.Fatalf("grant: %d", status)
		}
	}
	grant()
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/"+crew+"/leave", ""); status != http.StatusNoContent && status != http.StatusOK {
		t.Fatalf("leave: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("rejoin: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusForbidden {
		t.Errorf("the grant outlived leaving the crew: join %d, want 403", status)
	}

	grant()
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/crews/"+crew+"/role", fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent && status != http.StatusOK {
		t.Fatalf("ban: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/crews/"+crew+"/role", fmt.Sprintf(`{"userId":%q,"role":"member"}`, bob)); status != http.StatusNoContent && status != http.StatusOK {
		t.Fatalf("unban: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusForbidden {
		t.Errorf("the grant outlived a crew ban: join %d, want 403", status)
	}
}

// Removal revokes the grant that let them in (#1672): the membership went,
// the door back stayed.
func TestRemovingAMemberRevokesTheirGrant(t *testing.T) {
	h := setup(t)
	open, _ := h.createRoom(t, "alice", "Crew Grant Remove Open")
	private, _ := h.createRoom(t, "alice", "Crew Grant Remove Private")
	h.makePrivate(t, private)
	h.join(t, "bob", open)
	bob := h.userID(t, "bob")
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+private+"/grants", fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusNoContent {
		t.Fatalf("grant: %d", status)
	}
	h.join(t, "bob", private)
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+private+"/members/"+bob, ""); status != http.StatusNoContent {
		t.Fatalf("remove: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+private+"/join", ""); status != http.StatusForbidden {
		t.Errorf("removed, and back in through the old grant: join %d, want 403", status)
	}
}

// The door has a ceiling (#1673): the sign-in one, per address, and the join
// spends the same window.
func TestTheCrewDoorHasACeiling(t *testing.T) {
	h := setup(t)
	for i := 0; i < doorGuessesPerWindow; i++ {
		if status, _ := h.call(t, "", http.MethodGet, "/api/crew-doors/ZZZZZZ", ""); status != http.StatusNotFound {
			t.Fatalf("guess %d: %d, want 404", i, status)
		}
	}
	if status, _ := h.call(t, "", http.MethodGet, "/api/crew-doors/ZZZZZZ", ""); status != http.StatusTooManyRequests {
		t.Fatalf("past the ceiling: %d, want 429", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", `{"code":"ZZZZZZ"}`); status != http.StatusTooManyRequests {
		t.Fatalf("the join after the ceiling: %d, want 429", status)
	}
	// The door's image spends the same window (#1736).
	if status, _ := h.call(t, "", http.MethodGet, "/api/crew-doors/ZZZZZZ/image", ""); status != http.StatusTooManyRequests {
		t.Fatalf("the image after the ceiling: %d, want 429", status)
	}
}

// SPEC's succession rule: never anyone the crew banned (#1675) — the last
// resort used to skip only the departing owner.
func TestTheSuccessorOfLastResortIsNeverBanned(t *testing.T) {
	h := setup(t)
	seed, _ := h.createRoom(t, "alice", "Crew Succession Seed")
	crew := h.crewOf(t, seed)
	h.join(t, "bob", seed)
	bobID := h.users.ByToken["bob"].ID
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{CrewID: crew.ID, UserID: bobID, Role: "admin"}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	status, created := h.call(t, "bob", http.MethodPost, "/api/rooms", fmt.Sprintf(`{"name":"Crew Succession Room","crewId":%q}`, store.UUIDString(crew.ID)))
	if status != http.StatusCreated {
		t.Fatalf("bob's room: %d %v", status, created)
	}
	slug, _ := created["slug"].(string)
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where slug = $1", slug) })
	// A ban row on a room owner, as databases from before the #1212 guard hold.
	if _, err := h.store.Pool.Exec(t.Context(), "update crew_roles set role = 'banned' where crew_id = $1 and user_id = $2", crew.ID, bobID); err != nil {
		t.Fatalf("ban row: %v", err)
	}
	_, err := h.store.Queries.FirstRoomOwnerInCrew(t.Context(), db.FirstRoomOwnerInCrewParams{CrewID: crew.ID, OwnerID: h.users.ByToken["alice"].ID})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("the last resort named a banned rider: %v", err)
	}
}

// The door's headcount and the roster agree even when a stray member row
// for the owner survives (#1932): both skip it.
func TestTheDoorCountsTheOwnerOnce(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Count Once")
	crew := h.crewOf(t, slug)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["alice"].ID, Role: "member",
	}); err != nil {
		t.Fatalf("stray owner row: %v", err)
	}
	status, door := h.call(t, "", http.MethodGet, "/api/crew-doors/"+code, "")
	if status != http.StatusOK {
		t.Fatalf("door: %d %v", status, door)
	}
	if door["members"] != float64(1) {
		t.Fatalf("the door counts the owner twice: %v", door["members"])
	}
}

// A pre-emptive ban of an id that is nobody is a 404, not a foreign-key
// violation dressed as a 500 (#1933).
func TestBanningNobodyIsNotFound(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Ban Nobody")
	crew := h.crewOf(t, slug)
	status, body := h.call(t, "alice", http.MethodPost, "/api/crews/"+store.UUIDString(crew.ID)+"/role",
		`{"userId":"00000000-0000-4000-8000-000000000000","role":"banned"}`)
	if status != http.StatusNotFound || body["error"] != "not_found" {
		t.Fatalf("banning nobody: %d %v, want 404 not_found", status, body)
	}
}

// The undo of a shut restores the listing the shut took with it (#1929).
func TestReopeningWithTheListingRestoresIt(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Reopen Listed")
	path := "/api/rooms/" + slug
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Crew Reopen Listed","listed":true,"crewVisible":true}`); status != http.StatusOK || body["listed"] != true {
		t.Fatalf("list: %d %v", status, body)
	}
	crew := h.crewOf(t, slug)
	access := "/api/crews/" + store.UUIDString(crew.ID) + "/rooms/" + store.UUIDString(roomID(t, h, slug)) + "/access"
	if status, _ := h.call(t, "alice", http.MethodPatch, access, `{"crewVisible":false}`); status != http.StatusNoContent {
		t.Fatalf("shut: %d", status)
	}
	// Reopening alone leaves it unlisted — the shut's rule (#1671) holds.
	if status, _ := h.call(t, "alice", http.MethodPatch, access, `{"crewVisible":true}`); status != http.StatusNoContent {
		t.Fatalf("reopen: %d", status)
	}
	if _, body := h.call(t, "alice", http.MethodGet, path, ""); body["listed"] != false {
		t.Fatalf("reopened alone, listed again: %v", body["listed"])
	}
	// The undo carries the listing back with the door.
	if status, _ := h.call(t, "alice", http.MethodPatch, access, `{"crewVisible":true,"listed":true}`); status != http.StatusNoContent {
		t.Fatalf("undo: %d", status)
	}
	if _, body := h.call(t, "alice", http.MethodGet, path, ""); body["listed"] != true || body["crewVisible"] != true {
		t.Fatalf("the undo did not restore both: listed=%v crewVisible=%v", body["listed"], body["crewVisible"])
	}
}
