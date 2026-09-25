package crews

import (
	"fmt"
	"net/http"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What a crew shows about its members (#2442): the Members page's read, the
// rider's own switches, the board and its disclosure at the door, and the
// recaps gated by the channel each session ran in.

func (h *harness) crewMembers(t *testing.T, who string, crew db.GetCrewRow) map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, crewPath(crew, "/members"), "")
	if status != http.StatusOK {
		t.Fatalf("%s reading the crew's members: %d %v", who, status, body)
	}
	return body
}

// A crew that rode in two voice channels in one week has one streak — the
// weeks are the crew's, not each channel's (docs/SPEC.md, Crew streak).
func TestACrewThatRodeInTwoChannelsInOneWeekHasOneStreak(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Streak Crew")
	h.join(t, "bob", crew)
	north := h.channel(t, crew, "voice", "North", false)
	south := h.channel(t, crew, "voice", "South", false)
	now := time.Now()
	h.crewRide(t, "alice", crew, north, now, 300)
	h.crewRide(t, "bob", crew, south, now, 300)
	h.crewRide(t, "bob", crew, north, now.AddDate(0, 0, -7), 300)

	body := h.crewMembers(t, "bob", crew)
	if body["streakWeeks"] != float64(2) {
		t.Errorf("streak = %v, want 2: this week and last, whichever channels rode", body["streakWeeks"])
	}
	together, _ := body["together"].(map[string]any)
	if together["sessionsThisMonth"] == nil {
		t.Fatalf("no together block: %v", body)
	}
}

// The board is off until the crew turns it on, and the door says which it is
// before anyone walks in (ADR-0036 as amended by ADR-0058).
func TestTheCrewBoardIsOffByDefaultAndTheDoorSaysSo(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Board Crew")
	code := codeOf(crew.Code)
	h.joinCrew(t, "bob", code)
	voice := h.channel(t, crew, "voice", "Ride", false)
	h.crewRide(t, "bob", crew, voice, time.Now(), 400)

	door := func() any {
		status, body := h.call(t, "", http.MethodGet, "/api/crew-doors/"+code, "")
		if status != http.StatusOK {
			t.Fatalf("door: %d %v", status, body)
		}
		return body["boardEnabled"]
	}
	if got := door(); got != false {
		t.Errorf("a new crew's door says boardEnabled = %v, want false", got)
	}
	body := h.crewMembers(t, "bob", crew)
	if body["boardEnabled"] != false || body["board"] != nil {
		t.Errorf("a new crew keeps a board: enabled %v, rows %v", body["boardEnabled"], body["board"])
	}

	// A member cannot turn it on; the owner can.
	path := crewPath(crew)
	if status, _ := h.call(t, "bob", http.MethodPatch, path, `{"name":"Board Crew","boardEnabled":true}`); status != http.StatusForbidden {
		t.Errorf("a member turned the board on: %d, want 403", status)
	}
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Board Crew","boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("turning the board on: %d %v", status, body)
	}
	if got := door(); got != true {
		t.Errorf("the door of a crew with a board says boardEnabled = %v, want true", got)
	}

	// Carol walks in through a door that named the board, so she is on it.
	// Bob walked in through one that said "Joining shows nobody your
	// numbers" and never answered, so turning the board on does not put him
	// there (#2820). The owner, who never answered either, is not on it.
	h.joinCrew(t, "carol", code)
	h.crewRide(t, "carol", crew, voice, time.Now(), 500)
	h.crewRide(t, "alice", crew, voice, time.Now(), 900)
	onBoard := func() []string {
		board, _ := h.crewMembers(t, "bob", crew)["board"].([]any)
		var on []string
		for _, row := range board {
			line, _ := row.(map[string]any)
			on = append(on, fmt.Sprint(line["displayName"]))
		}
		sort.Strings(on)
		return on
	}
	if on := onBoard(); len(on) != 1 || on[0] != h.displayName(t, "carol") {
		t.Errorf("board = %v, want only carol", on)
	}

	// Bob says yes for himself, and only then is he ranked.
	if status, body := h.call(t, "bob", http.MethodPatch, path+"/me", `{"notify":true,"onBoard":true}`); status != http.StatusOK || body["onBoard"] != true {
		t.Fatalf("bob joining the board: %d %v", status, body)
	}
	want := []string{h.displayName(t, "bob"), h.displayName(t, "carol")}
	sort.Strings(want)
	if on := onBoard(); fmt.Sprint(on) != fmt.Sprint(want) {
		t.Errorf("board = %v, want %v", on, want)
	}
}

// The switches are the caller's own, and a new owner keeps theirs through
// the hand-over (#2432's note: the row used to be deleted, and a rider who
// had left the board came back on it at the default).
func TestANewOwnerKeepsTheirSwitchesThroughTheHandOver(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Switch Crew")
	h.join(t, "bob", crew)
	path := crewPath(crew)

	if status, _ := h.call(t, "bob", http.MethodPatch, path+"/me", `{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("bob's switches: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, path+"/transfer", fmt.Sprintf(`{"userId":%q}`, h.userID(t, "bob"))); status != http.StatusOK {
		t.Fatalf("hand-over: %d", status)
	}
	me, _ := h.crewMembers(t, "bob", crew)["me"].(map[string]any)
	if me["notify"] != false || me["onBoard"] != false {
		t.Errorf("the new owner's switches came back as %v, want both off", me)
	}
	if role := h.crewRole(t, crew, h.users.ByToken["bob"].ID); role != "owner" {
		t.Errorf("bob is %q, want owner", role)
	}
}

// A recap is presence, so it is read only by who may enter the channel its
// session ran in (docs/SPEC.md, Session recap retention).
func TestACrewRecapStaysInsideItsChannel(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Recap Crew")
	h.join(t, "bob", crew)
	h.join(t, "carol", crew)
	open := h.channel(t, crew, "voice", "Open", false)
	private := h.channel(t, crew, "voice", "Private", true)
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into channel_members (channel_id, user_id) values ($1, $2)`, private, h.users.ByToken["carol"].ID); err != nil {
		t.Fatalf("name carol: %v", err)
	}
	recapIn := func(channel pgtype.UUID, workout string, ended time.Time) {
		t.Helper()
		if _, err := h.store.Pool.Exec(t.Context(),
			`insert into session_recaps (crew_id, channel_id, workout, started_at, ended_at, riders)
			 values ($1, $2, $3, $4, $5, '[]'::jsonb)`,
			crew.ID, channel, workout, ended.Add(-time.Hour), ended); err != nil {
			t.Fatalf("recap: %v", err)
		}
	}
	recapIn(open, "Open ride", time.Now())
	recapIn(private, "Private ride", time.Now())
	recapIn(open, "Old ride", time.Now().AddDate(0, 0, -91))

	workouts := func(who string) []string {
		t.Helper()
		status, body := h.call(t, who, http.MethodGet, crewPath(crew, "/recaps"), "")
		if status != http.StatusOK {
			t.Fatalf("%s reading recaps: %d %v", who, status, body)
		}
		var out []string
		rows, _ := body["recaps"].([]any)
		for _, row := range rows {
			card, _ := row.(map[string]any)
			out = append(out, fmt.Sprint(card["workout"]))
		}
		return out
	}
	for who, want := range map[string]int{"alice": 2, "carol": 2, "bob": 1} {
		if got := workouts(who); len(got) != want {
			t.Errorf("%s reads %v, want %d recaps", who, got, want)
		}
	}
	if got := workouts("bob"); len(got) == 1 && got[0] != "Open ride" {
		t.Errorf("bob, named into nothing, reads %v", got)
	}
}

// A crew ban takes the private channels someone was named into, so lifting it
// hands none of them back — the one ban (ADR-0058), as a grant was (#1672).
func TestACrewBanTakesTheChannelsTheyWereNamedInto(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Ban Crew")
	h.join(t, "bob", crew)
	private := h.channel(t, crew, "text", "Private", true)
	bob := h.users.ByToken["bob"].ID
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into channel_members (channel_id, user_id) values ($1, $2)`, private, bob); err != nil {
		t.Fatalf("name bob: %v", err)
	}
	h.banFromCrew(t, crew, "bob")
	var named bool
	if err := h.store.Pool.QueryRow(t.Context(),
		`select exists (select 1 from channel_members where channel_id = $1 and user_id = $2)`, private, bob).Scan(&named); err != nil {
		t.Fatalf("read: %v", err)
	}
	if named {
		t.Error("bob is still named into the private channel after the crew banned him")
	}
}

// The Members page shows the ban list to the owner and admins only, as the
// crew page does: a ban list is a moderation surface, not roster gossip.
func TestTheMembersPageShowsItsBansToAdminsOnly(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Ban List Crew")
	for _, who := range []string{"bob", "carol"} {
		h.join(t, who, crew)
	}
	h.banFromCrew(t, crew, "bob")

	roster := func(who string) (members, banned int) {
		t.Helper()
		body := h.crewMembers(t, who, crew)
		people, _ := body["members"].([]any)
		bans, _ := body["banned"].([]any)
		return len(people), len(bans)
	}
	if members, banned := roster("carol"); members != 2 || banned != 0 {
		t.Errorf("a member's view of the roster: %d members, %d banned", members, banned)
	}
	if members, banned := roster("alice"); members != 2 || banned != 1 {
		t.Errorf("the owner's view of the roster: %d members, %d banned", members, banned)
	}
}

// Joining never demotes (JoinCrew): an admin who follows the crew's link
// again is still its admin.
func TestRejoiningTheCrewNeverDemotesAnAdmin(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Rejoin Crew")
	h.join(t, "bob", crew)
	h.makeCrewAdmin(t, crew, "bob")

	status, body := h.call(t, "bob", http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, codeOf(crew.Code)))
	if status != http.StatusOK || body["role"] != "admin" {
		t.Errorf("rejoining answered %d %v, want admin", status, body["role"])
	}
	if role := h.crewRole(t, crew, h.users.ByToken["bob"].ID); role != "admin" {
		t.Errorf("rejoining left bob %q, want admin", role)
	}
}

// The roster's medal count is every medal the crew's sessions awarded that
// rider, by id (#1371). It used to be a display-name match over the 24 most
// recent awards, which decayed as the crew rode and merged two riders with
// one name.
func TestTheRosterCountsEveryMedalARiderWonHere(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Medal Count Crew")
	h.join(t, "bob", crew)
	bob := h.users.ByToken["bob"].ID
	// A medal hangs off a ride; the ride's numbers are irrelevant here.
	var ride pgtype.UUID
	if err := h.store.Pool.QueryRow(t.Context(),
		`insert into rides (user_id, crew_id, channel_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
		 values ($1, $2, $3, 'Openers', now(), 600, 200, 120, 0.9, 250, ''::bytea) returning id`,
		bob, crew.ID, h.voice(t, crew)).Scan(&ride); err != nil {
		t.Fatalf("ride: %v", err)
	}
	for _, kind := range []string{"diesel", "hammer"} {
		if _, err := h.store.Pool.Exec(t.Context(),
			`insert into medals (crew_id, user_id, ride_id, kind) values ($1, $2, $3, $4)`,
			crew.ID, bob, ride, kind); err != nil {
			t.Fatalf("medal %s: %v", kind, err)
		}
	}

	members, _ := h.crewMembers(t, "alice", crew)["members"].([]any)
	counts := map[string]any{}
	for _, m := range members {
		row, _ := m.(map[string]any)
		counts[fmt.Sprint(row["displayName"])] = row["medals"]
	}
	if got := counts[h.displayName(t, "bob")]; got != float64(2) {
		t.Errorf("bob's medals = %v, want 2 (roster %v)", got, counts)
	}
	// None is no field at all (omitempty) — on a rider who is on the roster.
	aliceMedals, onRoster := counts[h.displayName(t, "alice")]
	if !onRoster || aliceMedals != nil {
		t.Errorf("alice's medals = %v (on the roster: %v), want none", aliceMedals, onRoster)
	}
}

// errors.md's four for the crew's member endpoints.
func TestCrewMemberEndpointsRefuseProperly(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Refusing Crew")
	base := crewPath(crew)
	for _, c := range []struct {
		who, method, path, body string
		want                    int
	}{
		{"", http.MethodGet, base + "/members", "", http.StatusUnauthorized},
		{"bob", http.MethodGet, base + "/members", "", http.StatusNotFound},
		{"bob", http.MethodGet, base + "/recaps", "", http.StatusNotFound},
		{"bob", http.MethodPatch, base + "/me", `{"notify":true,"onBoard":true}`, http.StatusNotFound},
		{"alice", http.MethodPatch, base + "/me", `{"notify":"yes"}`, http.StatusBadRequest},
		{"alice", http.MethodGet, "/api/crews/not-a-crew/members", "", http.StatusNotFound},
	} {
		if status, _ := h.call(t, c.who, c.method, c.path, c.body); status != c.want {
			t.Errorf("%s %s as %q = %d, want %d", c.method, c.path, c.who, status, c.want)
		}
	}
	// The owner's first answer writes the row their switches live on.
	status, body := h.call(t, "alice", http.MethodPatch, base+"/me", `{"notify":false,"onBoard":true}`)
	if status != http.StatusOK || body["notify"] != false || body["onBoard"] != true {
		t.Errorf("the owner's switches: %d %v", status, body)
	}
}
