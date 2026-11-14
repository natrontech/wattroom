package rides

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// kettental is one of WattRoom's own roads (routes/library.go): invented, so
// its name is free to travel with a ride.
const kettental = "7a77b0ad-0007-4000-8000-000000004248"

// rideOnLibraryRoad is two minutes along one of WattRoom's roads, the road
// by reference in the workout as the browser saves it: a free ride when
// steps is empty, else a workout ridden by its clock.
func rideOnLibraryRoad(name, steps string) string {
	samples := make([]string, 120)
	for i := range samples {
		samples[i] = fmt.Sprintf(`{"watts":200,"cadence":90,"m":%d,"alt":%g}`, 8*i+1, 1000+0.4*float64(i))
	}
	unscored := ""
	if steps == "" {
		unscored = `\"unscored\":true,`
	}
	return fmt.Sprintf(
		`{"workoutName":%q,"workoutJson":"{\"name\":\"%s\",%s\"steps\":[%s],\"road\":{\"routeId\":\"%s\",\"fromM\":0,\"toM\":20000}}","startedAt":%q,"samples":[%s]}`,
		name, name, unscored, steps, kettental, nextStart().Format(time.RFC3339), strings.Join(samples, ","))
}

// A ride on one of WattRoom's roads is named after it (#4248): a free ride
// is the road, everywhere a ride is named; a workout keeps its own name as
// its title, and the road is the name it is compared under.
func TestARideOnWattRoomsRoadIsNamedByIt(t *testing.T) {
	h := setup(t)

	status, free := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideOnLibraryRoad("Free ride", ""))
	if status != http.StatusCreated || free["workoutName"] != "Kettental-Runde" {
		t.Fatalf("free ride on the road: %d %v", status, free)
	}
	freeID, _ := free["id"].(string)
	if _, detail := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+freeID, ""); detail["workoutName"] != "Kettental-Runde" || detail["workoutOwnName"] != nil {
		t.Errorf("a free ride on the road reads as the road alone: %v / %v", detail["workoutName"], detail["workoutOwnName"])
	}
	w := cardRequest(t, h, "alice", freeID)
	if cd := w.Header().Get("Content-Disposition"); w.Code != http.StatusOK || !strings.HasSuffix(cd, "-kettental-runde.png\"") {
		t.Errorf("the poster of a free ride on the road: %d %q", w.Code, cd)
	}

	steady := `{\"type\":\"steady\",\"seconds\":120,\"target\":0.8}`
	status, workout := call(t, h.mux, "alice", http.MethodPost, "/api/rides", rideOnLibraryRoad("Sweet spot", steady))
	if status != http.StatusCreated || workout["workoutName"] != "Kettental-Runde" {
		t.Fatalf("workout on the road: %d %v", status, workout)
	}
	workoutID, _ := workout["id"].(string)
	if _, detail := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+workoutID, ""); detail["workoutOwnName"] != "Sweet spot" {
		t.Errorf("the workout's own name is not on its page: %v", detail["workoutOwnName"])
	}
	_, list := call(t, h.mux, "alice", http.MethodGet, "/api/rides", "")
	rides, _ := list["rides"].([]any)
	own := map[string]any{}
	for _, r := range rides {
		ride, _ := r.(map[string]any)
		id, _ := ride["id"].(string)
		own[id] = ride["workoutOwnName"]
	}
	if own[workoutID] != "Sweet spot" || own[freeID] != nil {
		t.Errorf("the list's own names: %v", own)
	}
	_, best := call(t, h.mux, "alice", http.MethodGet, "/api/rides/best?workout=Kettental-Runde&except="+freeID, "")
	if ride, _ := best["ride"].(map[string]any); ride == nil || ride["workoutOwnName"] != "Sweet spot" {
		t.Errorf("against your best lost the workout's name: %v", best)
	}
	if w := cardRequest(t, h, "alice", workoutID); !strings.HasSuffix(w.Header().Get("Content-Disposition"), "-sweet-spot.png\"") {
		t.Errorf("the workout's card: %d %q", w.Code, w.Header().Get("Content-Disposition"))
	}
	// The .fit is named by what was ridden: the workout, not the road.
	if status, body := rawExport(t, h, workoutID); status != http.StatusOK || !strings.HasSuffix(body, "-sweet-spot.fit\"") {
		t.Errorf("the workout's file: %d %q", status, body)
	}
	// The workout's own name rides the account's own reads only, as the
	// title does: a bearer's list carries the name it is compared under.
	if _, body := rawGet(t, h, "/api/rides", true); strings.Contains(body, "workoutOwnName") {
		t.Errorf("a bearer's list carries the workout's own name: %s", body)
	}
}

// rawExport is the .fit download's Content-Disposition.
func rawExport(t *testing.T, h *harness, id string) (int, string) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides/"+id+"/export", nil)
	req.Header.Set("X-Test-User", "alice")
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	return w.Code, w.Header().Get("Content-Disposition")
}
