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
