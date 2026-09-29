package crews

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// tellingRoute gives who the telling road — ends that give themselves away —
// from src, and returns its id.
func (h *harness) tellingRoute(t *testing.T, who, src string) string {
	t.Helper()
	row, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
		OwnerID: h.users.ByToken[who].ID, Src: src, Name: "Home loop", GenName: "Road · 3.0 km · 50 m",
		Road: testx.TellingRoad(), RoadHash: "telling", LengthM: 3000, GainM: 50,
		Climbs: []byte("[]"), EleSource: "file",
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	return store.UUIDString(row.ID)
}

func roadPlanBody(routeID string, at time.Time) string {
	workout := `{"name":"Home loop","road":{"routeId":"` + routeID + `","fromM":0,"toM":3000},"steps":[{"type":"road","seconds":600}]}`
	return fmt.Sprintf(`{"workoutName":"Home loop","workoutJson":%q,"startsAt":%q,"channelId":""}`, workout, at.UTC().Format(time.RFC3339))
}

// No point, heading or height inside a hidden end reaches a crew member
// through a plan (#3051, ADR-0063): bob reads alice's planned road as the
// stretch between its anchors, from zero — and alice reads all of it.
func TestAPlansRoadReachesTheCrewCut(t *testing.T) {
	h := setup(t)
	h.svc.SetRoads(routes.NewAttacher(h.store.Queries))
	crew, _ := h.crewWithChannel(t)
	route := h.tellingRoute(t, "alice", "gpx")
	status, body := h.call(t, "alice", http.MethodPost, schedulePath(crew), roadPlanBody(route, time.Now().Add(24*time.Hour)))
	if status != http.StatusCreated {
		t.Fatalf("alice plans her road: %d %v", status, body)
	}
	plan, _ := body["id"].(string)
	var stored *string
	if err := h.store.Pool.QueryRow(t.Context(), `select route_id::text from scheduled_sessions where id = $1`, plan).Scan(&stored); err != nil || stored == nil || *stored != route {
		t.Fatalf("the plan's route_id is %v (%v), want %s", stored, err, route)
	}

	for _, c := range []struct {
		who     string
		samples int
		origin  float64
	}{{"alice", 151, 0}, {"bob", 111, protocol.RouteHiddenEndM}} {
		entry := h.crewSchedule(t, c.who, crew)[plan]
		raw, _ := entry["workoutJson"].(string)
		var w struct {
			Road struct {
				Profile string  `json:"profile"`
				OriginM float64 `json:"originM"`
			} `json:"road"`
		}
		if err := json.Unmarshal([]byte(raw), &w); err != nil {
			t.Fatalf("%s's plan workout unreadable: %v", c.who, err)
		}
		packed, err := base64.StdEncoding.DecodeString(w.Road.Profile)
		if err != nil {
			t.Fatal(err)
		}
		r, err := road.UnpackRoad(packed)
		if err != nil {
			t.Fatalf("%s's profile: %v", c.who, err)
		}
		if len(r.Heights) != c.samples || w.Road.OriginM != c.origin {
			t.Errorf("%s reads %d samples from %v m, want %d from %v", c.who, len(r.Heights), w.Road.OriginM, c.samples, c.origin)
		}
		if c.who != "bob" {
			continue
		}
		for i, height := range r.Heights {
			if height != 0 {
				t.Fatalf("bob holds height %d at %v m: an end's rise or an absolute altitude", i, height)
			}
		}
		for i, turn := range r.Turns {
			if turn == testx.TellingEndTurn {
				t.Fatalf("bob holds turn %d of a hidden end", i)
			}
		}
	}
}

// Only a route's owner plans it for the crew, and never one from Strava.
func TestOnlyTheOwnerPlansTheirRoad(t *testing.T) {
	h := setup(t)
	h.svc.SetRoads(routes.NewAttacher(h.store.Queries))
	crew, _ := h.crewWithChannel(t)
	alices := h.tellingRoute(t, "alice", "gpx")
	strava := h.tellingRoute(t, "alice", "stravagpx")
	at := time.Now().Add(24 * time.Hour)
	for _, c := range []struct {
		who, route string
	}{{"bob", alices}, {"alice", strava}} {
		status, body := h.call(t, c.who, http.MethodPost, schedulePath(crew), roadPlanBody(c.route, at))
		if status != http.StatusForbidden || body["field"] != "workoutJson" {
			t.Errorf("%s planning route %s: %d %v, want 403 on workoutJson", c.who, c.route, status, body)
		}
	}
}
