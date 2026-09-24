package rides

import (
	"context"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A ride ridden in a session names the crew it was ridden with and the
// voice channel it was ridden in (#2443), on the list and on the ride's own
// page; a solo ride names neither.
func TestARideNamesItsCrewAndChannel(t *testing.T) {
	h := setup(t)
	alice := h.users.ByToken["alice"].ID
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "Thursday Crew", OwnerID: alice, Code: testx.CrewCode()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	channel, err := h.store.Queries.CreateChannel(t.Context(), db.CreateChannelParams{CrewID: crew.ID, Kind: "voice", Name: "Pain Cave", MaxChannels: 10})
	if err != nil {
		t.Fatal(err)
	}
	session := h.save(t, "alice", 120, 200)
	solo := h.save(t, "alice", 90, 180)
	sessionID, _ := store.ParseUUID(session)
	if _, err := h.store.Pool.Exec(t.Context(),
		"update rides set crew_id = $1, channel_id = $2 where id = $3", crew.ID, channel.ID, sessionID); err != nil {
		t.Fatal(err)
	}

	named := func(ride map[string]any, key string) string {
		place, _ := ride[key].(map[string]any)
		name, _ := place["name"].(string)
		return name
	}
	_, list := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	rides, _ := list["rides"].([]any)
	found := 0
	for _, r := range rides {
		ride, _ := r.(map[string]any)
		switch ride["id"] {
		case session:
			found++
			if named(ride, "crew") != "Thursday Crew" || named(ride, "channel") != "Pain Cave" {
				t.Errorf("the session ride on the list: crew %v channel %v", ride["crew"], ride["channel"])
			}
		case solo:
			found++
			if ride["crew"] != nil || ride["channel"] != nil {
				t.Errorf("the solo ride on the list names crew %v channel %v", ride["crew"], ride["channel"])
			}
		}
	}
	if found != 2 {
		t.Fatalf("the list holds %d of the two rides", found)
	}
	_, detail := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+session, "")
	if named(detail, "crew") != "Thursday Crew" || named(detail, "channel") != "Pain Cave" {
		t.Errorf("the session ride's page: crew %v channel %v", detail["crew"], detail["channel"])
	}
	_, detail = call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+solo, "")
	if detail["crew"] != nil || detail["channel"] != nil {
		t.Errorf("the solo ride's page names crew %v channel %v", detail["crew"], detail["channel"])
	}
}

// A session ride outlives its crew (#2630). Deleting the crew sets the ride's
// crew and channel null, and the ride then read "solo" on the list and on its
// page — a ride ridden with friends, relabelled. The session it was ridden in
// is still on the row, so both say it was a session ride. And a rider no
// longer in the crew is told its name, not handed a door into it: the page
// linked every crew on a ride, and one the rider had left was a 404.
func TestASessionRideStaysOneWhenItsCrewIsGone(t *testing.T) {
	h := setup(t)
	alice := h.users.ByToken["alice"].ID
	bob := h.users.ByToken["bob"].ID
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "Thursday Crew", OwnerID: bob, Code: testx.CrewCode()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	if _, err := h.store.Pool.Exec(t.Context(),
		"insert into crew_roles (crew_id, user_id, role) values ($1, $2, 'member')", crew.ID, alice); err != nil {
		t.Fatal(err)
	}
	ride := h.save(t, "alice", 120, 200)
	solo := h.save(t, "alice", 90, 180)
	rideID, _ := store.ParseUUID(ride)
	if _, err := h.store.Pool.Exec(t.Context(),
		"update rides set crew_id = $1, session_id = gen_random_uuid() where id = $2", crew.ID, rideID); err != nil {
		t.Fatal(err)
	}

	page := func(id string) map[string]any {
		t.Helper()
		status, body := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+id, "")
		if status != http.StatusOK {
			t.Fatalf("ride %s: %d %v", id, status, body)
		}
		return body
	}
	listed := func(id string) map[string]any {
		t.Helper()
		_, list := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
		rides, _ := list["rides"].([]any)
		for _, r := range rides {
			if ride, _ := r.(map[string]any); ride["id"] == id {
				return ride
			}
		}
		t.Fatalf("ride %s is not on the list", id)
		return nil
	}

	if d := page(ride); d["crewMember"] != true || d["room"] != true {
		t.Errorf("a member's session ride: crewMember %v room %v", d["crewMember"], d["room"])
	}
	if d := page(solo); d["room"] == true || d["crewMember"] == true {
		t.Errorf("a solo ride: room %v crewMember %v", d["room"], d["crewMember"])
	}

	// Alice leaves: the crew is still named, and no longer hers to enter.
	if _, err := h.store.Pool.Exec(t.Context(),
		"delete from crew_roles where crew_id = $1 and user_id = $2", crew.ID, alice); err != nil {
		t.Fatal(err)
	}
	if d := page(ride); d["crew"] == nil || d["crewMember"] == true {
		t.Errorf("after leaving: crew %v crewMember %v", d["crew"], d["crewMember"])
	}

	// The crew goes: the ride is still a session ride, on the list and the page.
	if _, err := h.store.Pool.Exec(t.Context(), "delete from crews where id = $1", crew.ID); err != nil {
		t.Fatal(err)
	}
	if r := listed(ride); r["crew"] != nil || r["room"] != true {
		t.Errorf("the list, crew gone: crew %v room %v", r["crew"], r["room"])
	}
	if d := page(ride); d["crew"] != nil || d["room"] != true {
		t.Errorf("the page, crew gone: crew %v room %v", d["crew"], d["room"])
	}
	if r := listed(solo); r["room"] == true {
		t.Errorf("the solo ride reads as a session ride: %v", r["room"])
	}
}
