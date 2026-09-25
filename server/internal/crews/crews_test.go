package crews

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// kickRecorder is the presence hook with a memory: which voice channels a
// crew ban or a leave severed. fakePresence's other methods ride along.
type kickRecorder struct {
	fakePresence
	kicked []string
}

func (k *kickRecorder) Kick(channel, _ string) { k.kicked = append(k.kicked, channel) }

// stranger is a signed-in rider in no crew at all, for the disclosures that
// turn on membership rather than on being signed in.
func (h *harness) stranger(t *testing.T) string {
	t.Helper()
	u, err := h.store.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "dave", FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		t.Fatalf("create the stranger: %v", err)
	}
	h.users.ByToken["dave"] = u
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	return "dave"
}

// placeholderCrew is a crew nobody has named yet: called after its owner and
// never renamed, the way every crew the rooms era opened for a rider began
// (#1151). A crew founded by name is named from its first moment.
func (h *harness) placeholderCrew(t *testing.T, owner string) db.GetCrewRow {
	t.Helper()
	user := h.users.ByToken[owner]
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{
		Name: user.DisplayName, OwnerID: user.ID, Code: testx.CrewCode(),
	})
	if err != nil {
		t.Fatalf("placeholder crew: %v", err)
	}
	return h.crew(t, store.UUIDString(crew.ID))
}

// closeChannels makes every channel the crew has private, so who enters what
// is only ever the owner, the admins and whoever is named in.
func (h *harness) closeChannels(t *testing.T, crew db.GetCrewRow) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(), "update channels set private = true where crew_id = $1", crew.ID); err != nil {
		t.Fatalf("close channels: %v", err)
	}
}

// nameInto admits who to a private channel. Straight to the table: the
// admission is the fixture, never the thing under test.
func (h *harness) nameInto(t *testing.T, channel pgtype.UUID, who string) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(),
		"insert into channel_members (channel_id, user_id) values ($1, $2)", channel, h.users.ByToken[who].ID); err != nil {
		t.Fatalf("name %s into the channel: %v", who, err)
	}
}

// namedInto says whether who is still named into a private channel.
func (h *harness) namedInto(t *testing.T, channel pgtype.UUID, who string) bool {
	t.Helper()
	var named bool
	if err := h.store.Pool.QueryRow(t.Context(),
		"select exists (select 1 from channel_members where channel_id = $1 and user_id = $2)",
		channel, h.users.ByToken[who].ID).Scan(&named); err != nil {
		t.Fatalf("read the channel's names: %v", err)
	}
	return named
}

// roster is the crew page's people as who reads them, by display name, in
// the page's own order.
func (h *harness) roster(t *testing.T, who string, crew db.GetCrewRow) []string {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, crewPath(crew), "")
	if status != http.StatusOK {
		t.Fatalf("%s reading the crew: %d %v", who, status, body)
	}
	people, _ := body["people"].([]any)
	out := []string{}
	for _, p := range people {
		person, _ := p.(map[string]any)
		out = append(out, fmt.Sprint(person["displayName"]))
	}
	return out
}

// The deliberate hand-over (#1208): owner only, to someone in the crew, and
// the old owner stays on as an admin. The new owner's own role row is settled
// with it (#1212) — owner beats every row, and a stale one is a lockout.
func TestTheOwnerHandsTheCrewOn(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Handover")
	h.join(t, "bob", crew)
	path := crewPath(crew, "/transfer")
	bob := h.userID(t, "bob")
	carol := h.userID(t, "carol")
	h.makeCrewAdmin(t, crew, "bob")

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
		// Kept as a plain member (#2442): the row carries their switches,
		// and owner beats it everywhere it is read.
		if row.UserID == h.users.ByToken["bob"].ID && row.Role != "member" {
			t.Errorf("the new owner holds a %s row, want member", row.Role)
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

// Succession settles the successor's row too: bob, an admin, inherits when
// alice leaves for good (the purge path), and inherits clean — a plain member
// row carrying his switches (#2442), no admin word on it (#1212).
func TestTheSuccessorInheritsWithAPlainMemberRow(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Successor Row")
	h.join(t, "bob", crew)
	h.makeCrewAdmin(t, crew, "bob")
	if _, err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	if after := h.crew(t, store.UUIDString(crew.ID)); after.OwnerID != h.users.ByToken["bob"].ID {
		t.Fatalf("the crew passed to %s, want bob — test proves nothing", store.UUIDString(after.OwnerID))
	}
	roles, err := h.store.Queries.ListCrewRoles(t.Context(), crew.ID)
	if err != nil {
		t.Fatalf("crew roles: %v", err)
	}
	for _, row := range roles {
		if row.UserID == h.users.ByToken["bob"].ID && row.Role != "member" {
			t.Errorf("the successor inherited with a %s row still on them", row.Role)
		}
	}
}

// A founder who deletes their account leaves founded_by NULL on the crew
// they handed on (#2815). The successor's crew list must still load — it
// answered 500 for everyone left in the crew, on every crew they were in.
func TestACrewOutlivesItsFoundersAccountInTheCrewList(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Founder Gone")
	h.join(t, "bob", crew)
	alice := h.users.ByToken["alice"].ID
	if err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, alice); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, err := h.store.Pool.Exec(t.Context(), "delete from users where id = $1", alice); err != nil {
		t.Fatalf("delete the founder: %v", err)
	}

	status, body := h.call(t, "bob", http.MethodGet, "/api/crews", "")
	if status != http.StatusOK {
		t.Fatalf("the successor's crew list: %d %v", status, body)
	}
	crews, _ := body["crews"].([]any)
	if len(crews) != 1 {
		t.Fatalf("crews = %v, want the one bob inherited", body)
	}
	got, _ := crews[0].(map[string]any)
	if got["founded"] == true || got["role"] != "owner" {
		t.Errorf("bob's inherited crew reads founded=%v role=%v, want not founded and owner", got["founded"], got["role"])
	}
}

// The door (#1236) knows its own: a member following the crew's link again
// is told they are in and handed the way in; a stranger is not handed the
// crew's id, which is not theirs to know until they join.
func TestTheCrewDoorKnowsWhoIsAlreadyIn(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Door Knows")
	code := codeOf(crew.Code)
	_, stranger := h.call(t, "bob", http.MethodGet, "/api/crew-doors/"+code, "")
	if stranger["inCrew"] != nil || stranger["id"] != nil {
		t.Errorf("a stranger at the door learned more than the name: %v", stranger)
	}
	_, owner := h.call(t, "alice", http.MethodGet, "/api/crew-doors/"+code, "")
	if owner["inCrew"] != true || owner["id"] != store.UUIDString(crew.ID) {
		t.Errorf("the owner at their own door is not told they are in: %v", owner)
	}
	// The headcount is a member's to know (#1399): they can read the roster
	// itself on the crew's page.
	if owner["members"] == nil {
		t.Errorf("the owner at their own door is not told how many are in it: %v", owner)
	}
	// Signed out (#1677): the name, the icon and the image — and nothing that
	// is only a member's to know, the headcount included (#1399).
	status, anon := h.call(t, "", http.MethodGet, "/api/crew-doors/"+code, "")
	if status != http.StatusOK {
		t.Fatalf("the door signed out: %d", status)
	}
	for _, key := range []string{"id", "inCrew", "banned", "code", "channels", "people", "members"} {
		if _, has := anon[key]; has {
			t.Errorf("the door hands a signed-out caller %q: %v", key, anon)
		}
	}
	if anon["name"] == nil {
		t.Errorf("the door withholds the name signed out: %v", anon)
	}
	if status, _ := h.call(t, "", http.MethodGet, "/api/crew-doors/ZZZZZZ", ""); status != http.StatusNotFound {
		t.Errorf("an unknown code: %d, want 404", status)
	}
}

// A stranger at the door cannot tell a crew of one from a crew of two
// (#1399). ADR-0038's amendment gives the door the crew's name and what
// joining shows; ADR-0039 refused a headcount to a stranger as "a separate
// disclosure". So two crews alike in everything but their size must read
// identically to a caller who has only the code — signed out, and signed in
// as somebody who is in neither.
func TestTheDoorTellsAStrangerNothingAboutCrewSize(t *testing.T) {
	h := setup(t)
	small := codeOf(h.newCrew(t, "alice", "Door Size Small").Code)
	largeCrew := h.newCrew(t, "bob", "Door Size Large")
	large := codeOf(largeCrew.Code)
	h.join(t, "carol", largeCrew)
	// Everything but the size held equal, so any difference in the two
	// responses is the size and nothing else.
	for _, code := range []string{small, large} {
		if _, err := h.store.Pool.Exec(t.Context(),
			"update crews set name = 'Same Name', icon = 'bolt' where code = $1", code); err != nil {
			t.Fatalf("level the crews: %v", err)
		}
	}
	// A signed-in caller who is in neither crew: the stranger ADR-0039 means,
	// who holds a code and nothing else.
	for _, who := range []string{"", h.stranger(t)} {
		_, one := h.call(t, who, http.MethodGet, "/api/crew-doors/"+small, "")
		_, two := h.call(t, who, http.MethodGet, "/api/crew-doors/"+large, "")
		if !maps.Equal(one, two) {
			t.Errorf("the door tells %q the crew's size: %v vs %v", who, one, two)
		}
		if _, has := two["members"]; has {
			t.Errorf("the door hands %q a headcount: %v", who, two)
		}
	}
}

func TestRenamingTheCrewIsForItsOwnerAndAdmins(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Rename")
	h.join(t, "bob", crew)
	path := crewPath(crew)

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
	// A member's own read carries the rename, and the code is still theirs.
	status, seen := h.call(t, "bob", http.MethodGet, path, "")
	if status != http.StatusOK || seen["name"] != "Natron" || seen["code"] != codeOf(crew.Code) {
		t.Errorf("bob's crew does not carry the rename and the code: %d %v", status, seen)
	}
}

func TestTheCrewPageShowsItsPeopleAndItsBansToAdminsOnly(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Page")
	h.join(t, "bob", crew)
	h.join(t, "carol", crew)
	path := crewPath(crew)
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

// Person-visibility follows the channels you may enter (#1135, re-keyed from
// rooms by #2465), on the crew page too: a member sees the crew-mates they
// share an enterable channel with, and not the members of a private channel
// they are outside of. The owner, who acts on people by id, sees everyone.
func TestTheCrewPageShowsAMemberOnlyThePeopleTheyCouldAlreadySee(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew People")
	// An open channel is every member's, so any one of them would put the
	// whole crew in view: only private channels can keep two members apart.
	bobs := h.channel(t, crew, "text", "Bobs", true)
	carols := h.channel(t, crew, "text", "Carols", true)
	h.closeChannels(t, crew)
	h.join(t, "bob", crew)
	h.join(t, "carol", crew)
	h.nameInto(t, bobs, "bob")
	h.nameInto(t, carols, "carol")

	if got := h.roster(t, "bob", crew); !slices.Equal(got, []string{"alice", "bob"}) {
		t.Errorf("bob sees %v — carol is in a private channel he cannot enter", got)
	}
	if got := h.roster(t, "alice", crew); !slices.Equal(got, []string{"alice", "bob", "carol"}) {
		t.Errorf("the owner sees %v, want the whole crew", got)
	}
	// And a channel they now share puts her in view.
	h.nameInto(t, bobs, "carol")
	if got := h.roster(t, "bob", crew); !slices.Equal(got, []string{"alice", "bob", "carol"}) {
		t.Errorf("bob sees %v after carol was named into his channel, want her too", got)
	}
}

// ADR-0038's third amendment, enforced at the API: a crew ban severs every
// voice channel in the crew on the spot and holds at the code, and lifting it
// restores membership rather than merely stopping the refusals.
func TestACrewBanSeversEveryVoiceChannelAndLiftingItRestoresMembership(t *testing.T) {
	h := setup(t)
	kicks := &kickRecorder{}
	h.svc.SetPresence(kicks)
	crew := h.newCrew(t, "alice", "Crew Ban")
	lounge := h.voice(t, crew)
	second := h.channel(t, crew, "voice", "Second", false)
	h.join(t, "bob", crew)
	bob := h.userID(t, "bob")
	path := crewPath(crew, "/role")

	if status, _ := h.call(t, "alice", http.MethodPost, path,
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("crew ban: %d", status)
	}
	slices.Sort(kicks.kicked)
	want := []string{store.UUIDString(lounge), store.UUIDString(second)}
	slices.Sort(want)
	if !slices.Equal(kicks.kicked, want) {
		t.Errorf("a crew ban severed %v, want every voice channel in the crew %v", kicks.kicked, want)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join",
		fmt.Sprintf(`{"code":%q}`, codeOf(crew.Code))); status != http.StatusForbidden {
		t.Errorf("crew-banned bob rejoined by the code: %d", status)
	}

	if status, _ := h.call(t, "alice", http.MethodPost, path,
		fmt.Sprintf(`{"userId":%q,"role":"member"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("crew unban: %d", status)
	}
	// Lifting the ban restores membership (ADR-0038): bob is back on the
	// crew's page, not merely allowed to knock on its door.
	if status, body := h.call(t, "bob", http.MethodGet, crewPath(crew), ""); status != http.StatusOK || body["role"] != "member" {
		t.Errorf("after the crew unban bob is not a member of the crew: %d %v", status, body["role"])
	}
}

func TestDemotingAnAdminLeavesThemAMember(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Demote Crew")
	h.join(t, "bob", crew)
	bob := h.userID(t, "bob")
	for _, role := range []string{"admin", "member"} {
		if status, _ := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"), fmt.Sprintf(`{"userId":%q,"role":%q}`, bob, role)); status != http.StatusNoContent {
			t.Fatalf("set %s: %d", role, status)
		}
		// Membership is a row (#1236): "member" is written, not cleared, or
		// the demotion ejects them from the crew.
		if status, body := h.call(t, "bob", http.MethodGet, crewPath(crew), ""); status != http.StatusOK || body["role"] != role {
			t.Errorf("made %s, bob sees the crew as %d %v", role, status, body["role"])
		}
	}
}

func TestTheCrewOwnerIsNeverATarget(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Owner")
	h.join(t, "bob", crew)
	h.makeCrewAdmin(t, crew, "bob")
	alice := h.userID(t, "alice")
	path := crewPath(crew, "/role")
	for _, role := range []string{"banned", "member", "admin"} {
		status, _ := h.call(t, "bob", http.MethodPost, path, fmt.Sprintf(`{"userId":%q,"role":%q}`, alice, role))
		if status != http.StatusBadRequest {
			t.Errorf("an admin set the owner to %s: %d", role, status)
		}
	}
	// And a plain member acts on nobody.
	h.join(t, "carol", crew)
	bob := h.userID(t, "bob")
	if status, _ := h.call(t, "carol", http.MethodPost, path, fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusForbidden {
		t.Errorf("a member banned an admin: %d", status)
	}
}

// ADR-0038's second amendment: a crew is never left ownerless. The owner
// leaving for good — the purge path — hands it to docs/SPEC.md's successor,
// and with nobody left to own it, it goes.
func TestACrewPassesOnWithItsOwnerAndGoesWithNobodyLeft(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Passes On")
	h.join(t, "bob", crew)

	if _, err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	after, err := h.store.Queries.GetCrew(t.Context(), crew.ID)
	if err != nil {
		t.Fatalf("the crew was deleted while bob still stood in it: %v", err)
	}
	if after.OwnerID != h.users.ByToken["bob"].ID {
		t.Errorf("the crew passed to %s, want bob", store.UUIDString(after.OwnerID))
	}
	if _, err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["bob"].ID); err != nil {
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

// Joining is the one way in (ADR-0038 amended): a crew role is for someone
// already in the crew. The role endpoint's upsert used to admit anyone an
// admin named by user id (audit 2026-09-09); a ban stays pre-emptive.
func TestACrewRoleIsForSomeoneAlreadyIn(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Role Stranger")
	code := codeOf(crew.Code)
	bob := h.userID(t, "bob")
	for _, role := range []string{"member", "admin"} {
		status, body := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"), fmt.Sprintf(`{"userId":%q,"role":%q}`, bob, role))
		if status != http.StatusBadRequest || body["field"] != "userId" {
			t.Errorf("a stranger was made %s: %d %v", role, status, body)
		}
	}
	if status, _ := h.call(t, "bob", http.MethodGet, crewPath(crew), ""); status != http.StatusNotFound {
		t.Errorf("bob reads the crew after the refusals: %d", status)
	}
	// Keeping someone out is not letting them in.
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"), fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bob)); status != http.StatusNoContent {
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

// Naming the crew is the server's word (#1151, audit 2026-09-09): a rename
// sets it, an icon pick with the same name does not, and the owner renaming
// THEMSELVES changes nothing — the client used to compare the two names.
func TestACrewIsNamedByRenamingIt(t *testing.T) {
	h := setup(t)
	crew := h.placeholderCrew(t, "alice")
	named := func() any {
		_, body := h.call(t, "alice", http.MethodGet, crewPath(crew), "")
		return body["named"]
	}
	if named() != false {
		t.Fatalf("a fresh crew reads as named: %v", named())
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, crewPath(crew), fmt.Sprintf(`{"name":%q,"icon":"flame"}`, crew.Name)); status != http.StatusOK {
		t.Fatalf("icon pick: %d", status)
	}
	if named() != false {
		t.Errorf("an icon pick with the same name counted as naming it")
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, crewPath(crew), `{"name":"Wadlichlepfer"}`); status != http.StatusOK {
		t.Fatalf("rename: %d", status)
	}
	if named() != true {
		t.Errorf("a rename did not name the crew")
	}
}

func TestJoiningTheCrewAnswersMember(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Join Answers")
	status, body := h.call(t, "bob", http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, codeOf(crew.Code)))
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
	crew := h.newCrew(t, "alice", "Crew Since")
	h.join(t, "bob", crew)
	bobID := h.users.ByToken["bob"].ID
	if _, err := h.store.Pool.Exec(t.Context(),
		"update crew_roles set joined_at = '2026-01-15', set_at = '2026-01-15' where crew_id = $1 and user_id = $2", crew.ID, bobID); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	bob := store.UUIDString(bobID)
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"), fmt.Sprintf(`{"userId":%q,"role":"admin"}`, bob)); status != http.StatusNoContent {
		t.Fatalf("promote: %d", status)
	}
	_, body := h.call(t, "alice", http.MethodGet, crewPath(crew), "")
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
// goes, with the sockets in every voice channel of the crew. Nothing covered
// the endpoint (audit 2026-09-09).
func TestLeavingTheCrew(t *testing.T) {
	h := setup(t)
	kicks := &kickRecorder{}
	h.svc.SetPresence(kicks)
	crew := h.newCrew(t, "alice", "Crew Leave")
	lounge := h.voice(t, crew)
	second := h.channel(t, crew, "voice", "Second", false)
	h.join(t, "bob", crew)
	if status, _ := h.call(t, "alice", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusBadRequest {
		t.Errorf("the owner left: %d", status)
	}
	kicks.kicked = nil
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	slices.Sort(kicks.kicked)
	want := []string{store.UUIDString(lounge), store.UUIDString(second)}
	slices.Sort(want)
	if !slices.Equal(kicks.kicked, want) {
		t.Errorf("leaving severed %v, want %v", kicks.kicked, want)
	}
	if role := h.crewRole(t, crew, h.users.ByToken["bob"].ID); role != "" {
		t.Errorf("bob still holds a %q row in the crew he left", role)
	}
	if got := h.roster(t, "alice", crew); slices.Contains(got, "bob") {
		t.Errorf("bob is still on the crew's roster: %v", got)
	}
	if status, _ := h.call(t, "bob", http.MethodGet, crewPath(crew), ""); status != http.StatusNotFound {
		t.Errorf("bob still reads the crew: %d", status)
	}
}

// An owner's own member row — their switches (#2432), or what a hand-over
// settled — does not list them twice: the page keys its list by id.
func TestAStrayOwnerRowDoesNotListTheOwnerTwice(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Owner Once")
	if _, err := h.store.Pool.Exec(t.Context(),
		"insert into crew_roles (crew_id, user_id, role) values ($1, $2, 'member') on conflict do nothing",
		crew.ID, h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("stray row: %v", err)
	}
	_, body := h.call(t, "alice", http.MethodGet, crewPath(crew), "")
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

// The confirm promised it (#1672): leaving the crew takes the private
// channels someone was named into, and the code does not hand them back.
func TestLeavingTheCrewTakesTheChannelsTheyWereNamedInto(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Leave Named")
	private := h.channel(t, crew, "text", "Private", true)
	h.join(t, "bob", crew)
	h.nameInto(t, private, "bob")
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath(crew, "/leave"), ""); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	h.join(t, "bob", crew)
	if h.namedInto(t, private, "bob") {
		t.Error("the naming outlived leaving the crew: bob is back in the private channel by the code alone")
	}
}

// The door has a ceiling (#1673): the sign-in one, per address, and the join
// spends the same window.
func TestTheCrewDoorHasACeiling(t *testing.T) {
	h := setup(t)
	for i := range doorGuessesPerWindow {
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

// SPEC's succession rule: never anyone the crew banned (#1675). With nobody
// else left the crew goes rather than passing to the banned rider.
func TestACrewWithNobodyButABannedRiderLeftGoes(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Crew Succession")
	h.join(t, "bob", crew)
	h.banFromCrew(t, crew, "bob")

	if _, err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["alice"].ID); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, err := h.store.Queries.GetCrew(t.Context(), crew.ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a crew with nobody but a banned rider left survived: %v", err)
	}
}

// The door's headcount and the roster agree even when a member row for the
// owner survives (#1932): both skip it.
func TestTheDoorCountsTheOwnerOnce(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Count Once")
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken["alice"].ID, Role: "member",
	}); err != nil {
		t.Fatalf("stray owner row: %v", err)
	}
	// Read as the owner: the count is a member's to see and no stranger's
	// (#1399).
	status, door := h.call(t, "alice", http.MethodGet, "/api/crew-doors/"+codeOf(crew.Code), "")
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
	crew := h.newCrew(t, "alice", "Ban Nobody")
	status, body := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"),
		`{"userId":"00000000-0000-4000-8000-000000000000","role":"banned"}`)
	if status != http.StatusNotFound || body["error"] != "not_found" {
		t.Fatalf("banning nobody: %d %v, want 404 not_found", status, body)
	}
}

// A leaked invite is not permanent (#1930): the owner or an admin makes a
// new code, the old door shuts, a member may not.
func TestANewInviteCodeShutsTheOldDoor(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Rotate Code")
	code := codeOf(crew.Code)
	h.joinCrew(t, "bob", code)
	if status, _ := h.call(t, "bob", http.MethodPost, crewPath(crew, "/code"), ""); status != http.StatusForbidden {
		t.Fatalf("a member re-keyed the crew: %d", status)
	}
	status, body := h.call(t, "alice", http.MethodPost, crewPath(crew, "/code"), "")
	fresh, _ := body["code"].(string)
	if status != http.StatusOK || len(fresh) != 6 || fresh == code {
		t.Fatalf("rotate: %d %v", status, body)
	}
	if status, _ := h.call(t, "carol", http.MethodGet, "/api/crew-doors/"+code, ""); status != http.StatusNotFound {
		t.Errorf("the old code still opens the door: %d", status)
	}
	if status, door := h.call(t, "carol", http.MethodGet, "/api/crew-doors/"+fresh, ""); status != http.StatusOK || door["name"] == nil {
		t.Errorf("the new code does not open the door: %d %v", status, door)
	}
}

// The invite a rider was sent to survives the tab it arrived in (#2144): the
// door says a stranger is invited, the remember POST writes it on the account,
// /api/me derives it while they are in no crew and the code still opens one,
// and the join clears it. A rider who already has a crew has somewhere to be,
// so nothing is derived for them however many doors they read.
func TestTheDoorRemembersTheInviteForARiderInNoCrew(t *testing.T) {
	h := setup(t)
	code := codeOf(h.newCrew(t, "alice", "Door Memory").Code)
	dave := h.stranger(t)
	daveID := h.users.ByToken[dave].ID

	if _, err := h.store.Queries.PendingCrewInvite(t.Context(), daveID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("an invite before any door: %v", err)
	}
	status, door := h.call(t, dave, http.MethodGet, "/api/crew-doors/"+code, "")
	if status != http.StatusOK || door["invited"] != true {
		t.Fatalf("door: %d %v, want an invited stranger", status, door)
	}
	if status, body := h.call(t, dave, http.MethodPost, "/api/crew-doors/"+code+"/remember", ""); status != http.StatusNoContent {
		t.Fatalf("remember: %d %v", status, body)
	}
	if got, err := h.store.Queries.PendingCrewInvite(t.Context(), daveID); err != nil || got != code {
		t.Fatalf("the door forgot the invite: %q, %v", got, err)
	}
	// Bob owns a crew of his own. The door still offers him the Join — he is
	// not in this one — and the remember still writes the code, but a rider
	// with a crew has somewhere to be, so nothing is derived for them.
	h.found(t, "bob", "Bob's Own")
	if status, body := h.call(t, "bob", http.MethodGet, "/api/crew-doors/"+code, ""); status != http.StatusOK || body["invited"] != true {
		t.Fatalf("door for bob: %d %v", status, body)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crew-doors/"+code+"/remember", ""); status != http.StatusNoContent {
		t.Fatalf("remember for bob: %d", status)
	}
	if got, err := h.store.Queries.PendingCrewInvite(t.Context(), h.users.ByToken["bob"].ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a rider with a crew holds an invite: %q, %v", got, err)
	}
	// A code that no longer opens anything is no invite.
	if _, err := h.store.Pool.Exec(t.Context(), "update users set pending_crew_code = 'ZZZZZZ' where id = $1", daveID); err != nil {
		t.Fatal(err)
	}
	if got, err := h.store.Queries.PendingCrewInvite(t.Context(), daveID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a dead code is still an invite: %q, %v", got, err)
	}
	// Answered: the join clears the code outright, so leaving the crew later
	// does not send the rider back to its door.
	if status, _ := h.call(t, dave, http.MethodPost, "/api/crew-doors/"+code+"/remember", ""); status != http.StatusNoContent {
		t.Fatalf("remember again: %d", status)
	}
	if status, body := h.call(t, dave, http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("join: %d %v", status, body)
	}
	if u, err := h.store.Queries.GetUser(t.Context(), daveID); err != nil || u.PendingCrewCode != nil {
		t.Fatalf("the join left the invite on the account: %v, %v", u.PendingCrewCode, err)
	}
}

// Reading the crew's door writes nothing to the caller's account (#2248).
// RequireUser asks for the Origin only on a mutating verb, and a SameSite=Lax
// cookie rides a cross-site top-level navigation — so while the door's GET set
// pending_crew_code, any page could pick which crew a signed-in rider's next
// landing opened, simply by linking them at it.
func TestReadingTheCrewDoorWritesNothing(t *testing.T) {
	h := setup(t)
	code := codeOf(h.newCrew(t, "alice", "Read-Only Door").Code)
	dave := h.stranger(t)
	daveID := h.users.ByToken[dave].ID

	for range 3 {
		if status, _ := h.call(t, dave, http.MethodGet, "/api/crew-doors/"+code, ""); status != http.StatusOK {
			t.Fatalf("door: %d", status)
		}
	}
	u, err := h.store.Queries.GetUser(t.Context(), daveID)
	if err != nil {
		t.Fatal(err)
	}
	if u.PendingCrewCode != nil {
		t.Fatalf("reading the door wrote %q to the account", *u.PendingCrewCode)
	}
}

// The remember is a write and answers like one (errors.md): signed out is a
// 401, an unknown code a 404 — the same answer the door gives, because a code
// is a secret.
func TestRememberingAnInviteRefusesWhatItShould(t *testing.T) {
	h := setup(t)
	code := codeOf(h.newCrew(t, "alice", "Remember Refusals").Code)
	if status, body := h.call(t, "", http.MethodPost, "/api/crew-doors/"+code+"/remember", ""); status != http.StatusUnauthorized {
		t.Fatalf("signed out: %d %v, want 401", status, body)
	}
	if status, body := h.call(t, h.stranger(t), http.MethodPost, "/api/crew-doors/ZZZZZZ/remember", ""); status != http.StatusNotFound || body["error"] != "not_found" {
		t.Fatalf("an unknown code: %d %v, want 404 not_found", status, body)
	}
}

// The crew's owner is on the roster for everyone in the crew, whatever
// channels they share (#1255). Carol joined by the code and is named into no
// channel at all, so the owner is someone she shares nothing with — and
// before this the page showed her fewer people than its header counted, and
// never named whose crew it was.
func TestTheCrewPageAlwaysNamesItsOwner(t *testing.T) {
	h := setup(t)
	// bob founds the crew and shuts every channel in it.
	crew := h.newCrew(t, "bob", "Owners Crew")
	h.closeChannels(t, crew)
	// alice is named into one of them; carol comes in by the code to nothing.
	h.join(t, "alice", crew)
	h.nameInto(t, h.voice(t, crew), "alice")
	h.join(t, "carol", crew)

	_, page := h.call(t, "carol", http.MethodGet, crewPath(crew), "")
	people, _ := page["people"].([]any)
	seen := map[string]string{}
	for _, p := range people {
		person, _ := p.(map[string]any)
		seen[fmt.Sprint(person["displayName"])] = fmt.Sprint(person["role"])
	}
	if seen["bob"] != "owner" {
		t.Errorf("carol's crew page does not name the owner: %v", seen)
	}
	// And the rule the owner is the exception to still holds: alice is in a
	// channel carol cannot enter, so nothing else leaked with him.
	if _, ok := seen["alice"]; ok {
		t.Errorf("the roster carries someone carol shares no channel with: %v", seen)
	}
	// The header counts the crew, and the list is allowed to be shorter —
	// but never shorter than it needs to be by leaving the owner out.
	if want := float64(3); page["members"] != want {
		t.Errorf("the crew page counts %v people, want %v", page["members"], want)
	}
	if len(seen) != 2 {
		t.Errorf("carol sees %d people (%v) — the owner and herself are the two reachable to her", len(seen), seen)
	}
}
