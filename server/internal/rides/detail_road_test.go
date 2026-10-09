package rides

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A road ride's page draws its own Skyline (#3639): the owner's read of the
// ride carries each second's metre and height, and a ride off a road neither.
func TestARoadRidesPageCarriesItsMetresAndHeights(t *testing.T) {
	h := setup(t)
	routeID, _ := storeRoute(t, h, "alice")
	samples := make([]string, 120)
	for i := range samples {
		samples[i] = fmt.Sprintf(`{"watts":250,"cadence":90,"m":%d,"alt":%d}`, 1000+8*i, 100+i)
	}
	body := fmt.Sprintf(
		`{"workoutName":"Free ride","workoutJson":"{\"name\":\"Free ride\",\"unscored\":true,\"steps\":[]}","startedAt":%q,"samples":[%s],"routeId":%q}`,
		nextStart().Format(time.RFC3339), strings.Join(samples, ","), routeID)
	status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", body)
	if status != http.StatusCreated {
		t.Fatalf("save: %d %v", status, got)
	}
	id, _ := got["id"].(string)
	_, detail := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+id, "")
	if road, _ := detail["road"].(map[string]any); road["routeId"] != routeID || road["name"] != "Home loop" || road["genName"] != "Road · 5.0 km · 100 m" {
		t.Errorf("road = %v, want the route %s under the owner's name and its generated one", detail["road"], routeID)
	}
	read, _ := detail["samples"].([]any)
	if len(read) != 120 {
		t.Fatalf("samples = %d, want 120", len(read))
	}
	last, _ := read[119].(map[string]any)
	if last["m"] != float64(1000+8*119) || last["alt"] != float64(100+119) {
		t.Errorf("the last second reads m=%v alt=%v, want %d and %d", last["m"], last["alt"], 1000+8*119, 100+119)
	}

	status, got = call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideBody(120, 200))
	if status != http.StatusCreated {
		t.Fatalf("save off a road: %d %v", status, got)
	}
	id, _ = got["id"].(string)
	_, detail = call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+id, "")
	if detail["road"] != nil {
		t.Errorf("a ride off a road names a road: %v", detail["road"])
	}
	read, _ = detail["samples"].([]any)
	if first, _ := read[0].(map[string]any); first["m"] != nil || first["alt"] != nil {
		t.Errorf("a ride off a road reads a place: %v", first)
	}
}

// A ride on the rider's own road carries it on their list and its page, under
// the name they know it by (#3874), so the ride is titled as the route page
// is. A session ridden on someone else's road carries neither its id nor its
// owner's rename (ADR-0063): the generated name it was saved under stays.
func TestARideNamesItsRoadOnlyToTheRoadsOwner(t *testing.T) {
	h := setup(t)
	routeID, _ := storeRoute(t, h, "alice")
	// The owner's rename, an invented place (testx.Corridor): what must not
	// reach anyone else.
	if _, err := h.store.Pool.Exec(t.Context(), "update routes set name = $1 where id = $2::uuid",
		testx.Corridor.Route, routeID); err != nil {
		t.Fatal(err)
	}
	status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", freeRideOn(routeID, 8, ""))
	if status != http.StatusCreated {
		t.Fatalf("save: %d %v", status, got)
	}
	own, _ := got["id"].(string)
	// Bob rode alice's road in her session: his ride names her route, as a
	// session's save does.
	theirs := h.save(t, "bob", 120, 200)
	theirsID, _ := store.ParseUUID(theirs)
	if _, err := h.store.Pool.Exec(t.Context(),
		"update rides set route_id = $1::uuid, workout_name = 'Road · 5.0 km · 100 m' where id = $2", routeID, theirsID); err != nil {
		t.Fatal(err)
	}

	listed := func(user, id string) map[string]any {
		_, list := call(t, h.mux, user, http.MethodGet, "/api/rides", "")
		rides, _ := list["rides"].([]any)
		for _, r := range rides {
			if ride, _ := r.(map[string]any); ride["id"] == id {
				return ride
			}
		}
		t.Fatalf("%s's list holds no ride %s", user, id)
		return nil
	}
	if road, _ := listed("alice", own)["road"].(map[string]any); road["routeId"] != routeID || road["name"] != testx.Corridor.Route || road["genName"] != "Road · 5.0 km · 100 m" {
		t.Errorf("alice's list: road = %v, want her route under her name", road)
	}
	_, detail := call(t, h.mux, "bob", http.MethodGet, "/api/rides/"+theirs, "")
	for where, ride := range map[string]map[string]any{"list": listed("bob", theirs), "page": detail} {
		if ride["road"] != nil {
			t.Errorf("bob's %s names alice's road: %v", where, ride["road"])
		}
		raw, _ := json.Marshal(ride)
		if leak := testx.Leak(string(raw)); leak != "" {
			t.Errorf("bob's %s carries %q", where, leak)
		}
	}
}
