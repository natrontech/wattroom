package rides

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
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
	if road, _ := detail["road"].(map[string]any); road["routeId"] != routeID || road["name"] != "Home loop" {
		t.Errorf("road = %v, want the route %s under the owner's name", detail["road"], routeID)
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
