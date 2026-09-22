package rooms

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What a crew shows about its members (#2442): the Members page's read, the
// rider's own switches, the board and its disclosure at the door, and the
// recaps gated by the channel each session ran in.

// channel makes one of the crew's channels straight in the table: channels
// get their API in #2434, and the channel is the fixture here, never the
// thing under test.
func (h *harness) channel(t *testing.T, crew db.GetCrewRow, kind, name string, private bool) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := h.store.Pool.QueryRow(t.Context(),
		`insert into channels (crew_id, kind, name, position, private) values ($1, $2, $3, 0, $4) returning id`,
		crew.ID, kind, name, private).Scan(&id); err != nil {
		t.Fatalf("channel %s: %v", name, err)
	}
	return id
}

// crewRide is a ride ridden in one of the crew's sessions, in a voice channel.
func (h *harness) crewRide(t *testing.T, who string, crew db.GetCrewRow, channel pgtype.UUID, at time.Time, kj int) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into rides (user_id, crew_id, channel_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
		 values ($1, $2, $3, 'Openers', $4, 1800, 200, $5, 0.9, 250, ''::bytea)`,
		h.users.ByToken[who].ID, crew.ID, channel, at, kj); err != nil {
		t.Fatalf("ride: %v", err)
	}
}

func (h *harness) crewMembers(t *testing.T, who string, crew db.GetCrewRow) map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID)+"/members", "")
	if status != http.StatusOK {
		t.Fatalf("%s reading the crew's members: %d %v", who, status, body)
	}
	return body
}

// A crew that rode in two voice channels in one week has one streak — the
// weeks are the crew's, not each channel's (docs/SPEC.md, Crew streak).
func TestACrewThatRodeInTwoChannelsInOneWeekHasOneStreak(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Streak Crew")
	crew := h.crewOf(t, slug)
	h.joinCrew(t, "bob", code)
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
	slug, code := h.createRoom(t, "alice", "Board Crew")
	crew := h.crewOf(t, slug)
	h.joinCrew(t, "bob", code)
	h.joinCrew(t, "carol", code)
	voice := h.channel(t, crew, "voice", "Ride", false)
	h.crewRide(t, "bob", crew, voice, time.Now(), 400)
	h.crewRide(t, "carol", crew, voice, time.Now(), 500)

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
	path := "/api/crews/" + store.UUIDString(crew.ID)
	if status, _ := h.call(t, "bob", http.MethodPatch, path, `{"name":"Board Crew","boardEnabled":true}`); status != http.StatusForbidden {
		t.Errorf("a member turned the board on: %d, want 403", status)
	}
	if status, body := h.call(t, "alice", http.MethodPatch, path, `{"name":"Board Crew","boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("turning the board on: %d %v", status, body)
	}
	if got := door(); got != true {
		t.Errorf("the door of a crew with a board says boardEnabled = %v, want true", got)
	}

	// Carol says no for herself; bob is on it, carol is not, and the owner —
	// who never answered — is not on it either.
	if status, body := h.call(t, "carol", http.MethodPatch, path+"/me", `{"notify":true,"onBoard":false}`); status != http.StatusOK || body["onBoard"] != false {
		t.Fatalf("carol leaving the board: %d %v", status, body)
	}
	h.crewRide(t, "alice", crew, voice, time.Now(), 900)
	board, _ := h.crewMembers(t, "bob", crew)["board"].([]any)
	var on []string
	for _, row := range board {
		line, _ := row.(map[string]any)
		on = append(on, fmt.Sprint(line["displayName"]))
	}
	if len(on) != 1 || on[0] != h.displayName(t, "bob") {
		t.Errorf("board = %v, want only bob", on)
	}
}

// The switches are the caller's own, and a new owner keeps theirs through
// the hand-over (#2432's note: the row used to be deleted, and a rider who
// had left the board came back on it at the default).
func TestANewOwnerKeepsTheirSwitchesThroughTheHandOver(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Switch Crew")
	crew := h.crewOf(t, slug)
	h.joinCrew(t, "bob", code)
	path := "/api/crews/" + store.UUIDString(crew.ID)

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
	slug, code := h.createRoom(t, "alice", "Recap Crew")
	crew := h.crewOf(t, slug)
	h.joinCrew(t, "bob", code)
	h.joinCrew(t, "carol", code)
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
		status, body := h.call(t, who, http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID)+"/recaps", "")
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
	slug, code := h.createRoom(t, "alice", "Ban Crew")
	crew := h.crewOf(t, slug)
	h.joinCrew(t, "bob", code)
	private := h.channel(t, crew, "text", "Private", true)
	bob := h.users.ByToken["bob"].ID
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into channel_members (channel_id, user_id) values ($1, $2)`, private, bob); err != nil {
		t.Fatalf("name bob: %v", err)
	}
	path := "/api/crews/" + store.UUIDString(crew.ID) + "/role"
	if status, _ := h.call(t, "alice", http.MethodPost, path, fmt.Sprintf(`{"userId":%q,"role":"banned"}`, store.UUIDString(bob))); status != http.StatusNoContent {
		t.Fatalf("ban: %d", status)
	}
	var named bool
	if err := h.store.Pool.QueryRow(t.Context(),
		`select exists (select 1 from channel_members where channel_id = $1 and user_id = $2)`, private, bob).Scan(&named); err != nil {
		t.Fatalf("read: %v", err)
	}
	if named {
		t.Error("bob is still named into the private channel after the crew banned him")
	}
}

// errors.md's four for the crew's member endpoints.
func TestCrewMemberEndpointsRefuseProperly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Refusing Crew")
	crew := h.crewOf(t, slug)
	base := "/api/crews/" + store.UUIDString(crew.ID)
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
