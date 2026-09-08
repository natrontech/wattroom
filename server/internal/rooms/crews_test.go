package rooms

import (
	"fmt"
	"net/http"
	"slices"
	"testing"

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
	if a.OwnerID != h.users.byToken["alice"].ID {
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
		RoomID: roomID(t, h, private), UserID: h.users.byToken["bob"].ID,
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if got := h.accessIn(t, "bob", private); got != "private" {
		t.Errorf("a granted rider reads the private room as %q, want private", got)
	}

	// A crew admin who never joined anything: listed, administrable, not
	// enterable — and the owner's own row would look the same (ADR-0038).
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.byToken["carol"].ID, Role: "admin",
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
	body := fmt.Sprintf(`{"userId":%q,"role":"banned"}`, store.UUIDString(h.users.byToken["bob"].ID))
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
	bob := store.UUIDString(h.users.byToken["bob"].ID)
	carol := store.UUIDString(h.users.byToken["carol"].ID)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.byToken["bob"].ID, Role: "admin",
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
	if err != nil || after.OwnerID != h.users.byToken["bob"].ID {
		t.Fatalf("bob does not own the crew: %v %v", err, after)
	}
	roles, _ := h.store.Queries.ListCrewRoles(t.Context(), crew.ID)
	for _, row := range roles {
		if row.UserID == h.users.byToken["bob"].ID {
			t.Errorf("the new owner still holds a %s row", row.Role)
		}
		if row.UserID == h.users.byToken["alice"].ID && row.Role != "admin" {
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
	bob := store.UUIDString(h.users.byToken["bob"].ID)
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
		CrewID: crew.ID, UserID: h.users.byToken["bob"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	if err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.byToken["alice"].ID); err != nil {
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
		CrewID: crew.ID, UserID: h.users.byToken["bob"].ID, Role: "admin",
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
	if c, _ := room["crew"].(map[string]any); c["name"] != "Natron" {
		t.Errorf("the rename did not reach the room list: %v", room["crew"])
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
		CrewID: crew.ID, UserID: h.users.byToken["carol"].ID, Role: "banned",
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
	if err := h.store.Queries.GrantRoomAccess(t.Context(), db.GrantRoomAccessParams{RoomID: roomID(t, h, private), UserID: h.users.byToken["carol"].ID}); err != nil {
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
	bob := store.UUIDString(h.users.byToken["bob"].ID)
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

func TestTheCrewOwnerIsNeverATarget(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Owner Room")
	crew := h.crewOf(t, slug)
	h.join(t, "bob", slug)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.byToken["bob"].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("admin: %v", err)
	}
	alice := store.UUIDString(h.users.byToken["alice"].ID)
	path := "/api/crews/" + store.UUIDString(crew.ID) + "/role"
	for _, role := range []string{"banned", "member", "admin"} {
		status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q,"role":%q}`, alice, role))
		if status != http.StatusBadRequest {
			t.Errorf("an admin set the owner to %s: %d", role, status)
		}
	}
	// And a plain member acts on nobody.
	h.join(t, "carol", slug)
	bob := store.UUIDString(h.users.byToken["bob"].ID)
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
	bob := h.users.byToken["bob"].ID
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
	if role, _ := h.store.Queries.CrewRoleOf(t.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: h.users.byToken["bob"].ID}); role != "member" {
		t.Errorf("bob's standing went with the room: %q, want member", role)
	}

	// The owner leaving for good — the purge path — hands it to the
	// longest-standing member (docs/SPEC.md), never leaving it ownerless.
	if err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.byToken["alice"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	after, err := h.store.Queries.GetCrew(t.Context(), crew.ID)
	if err != nil {
		t.Fatalf("the crew was deleted while bob still stood in it: %v", err)
	}
	if after.OwnerID != h.users.byToken["bob"].ID {
		t.Errorf("the crew passed to %s, want bob", store.UUIDString(after.OwnerID))
	}
	// And with nobody left to own it, it goes.
	if err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.byToken["bob"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, err := h.store.Queries.GetCrew(t.Context(), crew.ID); err == nil {
		t.Errorf("a crew with nobody in it survived")
	}
}
