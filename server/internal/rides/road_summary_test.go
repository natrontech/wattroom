package rides

import (
	"bytes"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// storeRoute gives a rider a 5 km route climbing 100 m, and returns its id
// and road hash.
func storeRoute(t *testing.T, h *harness, user string) (string, string) {
	t.Helper()
	row, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
		OwnerID: h.users.ByToken[user].ID, Src: "gpx", Name: "Home loop", GenName: "Road · 5.0 km · 100 m",
		Road: testx.FlatRoad(5000, 100), RoadHash: "hash-" + user, LengthM: 5000, GainM: 100,
		Climbs: []byte("[]"), EleSource: "file",
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	return store.UUIDString(row.ID), "hash-" + user
}

// freeRideOn is a two-minute free ride at 250 W whose client says it moved
// `clientMps` a second from 1,000 m along the road.
func freeRideOn(routeID string, clientMps float64, drive string) string {
	samples := make([]string, 120)
	for i := range samples {
		samples[i] = fmt.Sprintf(`{"watts":250,"cadence":90,"m":%g}`, 1000+clientMps*float64(i))
	}
	driven := ""
	if drive != "" {
		driven = fmt.Sprintf(`,"drive":%q`, drive)
	}
	return fmt.Sprintf(
		`{"workoutName":"Free ride","workoutJson":"{\"name\":\"Free ride\",\"unscored\":true,\"steps\":[]}","startedAt":%q,"samples":[%s],"routeId":%q%s}`,
		nextStart().Format(time.RFC3339), strings.Join(samples, ","), routeID, driven)
}

type summary struct {
	routeID, routeKey, roadH, mode *string
	timeable                       *bool
	fromM, distanceM, climbedM     *int32
	weightKg                       *int16
}

func readSummary(t *testing.T, h *harness, rideID string) summary {
	t.Helper()
	var s summary
	err := h.store.Pool.QueryRow(t.Context(), `
		select route_id::text, route_key, road_h, ride_mode, timeable, from_m, distance_m, climbed_m, weight_kg
		from rides where id = $1`, rideID).Scan(
		&s.routeID, &s.routeKey, &s.roadH, &s.mode, &s.timeable, &s.fromM, &s.distanceM, &s.climbedM, &s.weightKg)
	if err != nil {
		t.Fatalf("read ride: %v", err)
	}
	return s
}

// A free ride on the rider's own route keeps where and how it was ridden
// (#3053) — and its distance is the server's replay, never the client's
// metres, which are only compared: a gap past 1 % is logged, not kept.
func TestARoadRideKeepsItsSummaryAndTheReplayIsTheRecord(t *testing.T) {
	var logged bytes.Buffer
	h := setupWith(t, slog.New(slog.NewTextHandler(&logged, nil)))
	routeID, hash := storeRoute(t, h, "alice")

	// The client claims 20 m/s, far past what 250 W holds on 2 %.
	status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", freeRideOn(routeID, 20, stats.DriveSIM))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, got)
	}
	id, ok := got["id"].(string)
	if !ok {
		t.Fatalf("create returned no ride id: %v", got)
	}
	s := readSummary(t, h, id)

	ridden, err := road.UnpackRoad(testx.FlatRoad(5000, 100))
	if err != nil {
		t.Fatal(err)
	}
	samples := make([]protocol.RiderMetrics, 120)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 250, M: 1000 + 20*float64(i)}
	}
	want := stats.ReplayRoad(ridden, samples, 70+protocol.BikeKg)

	if s.routeID == nil || *s.routeID != routeID || s.routeKey == nil || *s.routeKey != hash || s.roadH == nil || *s.roadH != hash {
		t.Errorf("route %v, key %v, road %v; want %s and %s twice", s.routeID, s.routeKey, s.roadH, routeID, hash)
	}
	if s.mode == nil || *s.mode != "free" || s.timeable == nil || !*s.timeable {
		t.Errorf("mode %v, timeable %v; want a timeable free ride", s.mode, s.timeable)
	}
	if s.fromM == nil || *s.fromM != 1000 || s.distanceM == nil || int(*s.distanceM) != int(want.DistanceM+0.5) {
		t.Errorf("from %v m, %v m ridden; want 1000 and the replay's %.0f", s.fromM, s.distanceM, want.DistanceM)
	}
	if s.climbedM == nil || int(*s.climbedM) != int(want.ClimbedM+0.5) {
		t.Errorf("climbed %v m, want %.0f", s.climbedM, want.ClimbedM)
	}
	if s.weightKg != nil {
		t.Errorf("a default weight was kept: %d", *s.weightKg)
	}
	if !strings.Contains(logged.String(), "road ride replay parts from the client") {
		t.Errorf("a client 60 %% off the replay went unlogged:\n%s", logged.String())
	}
	if got["distanceM"] == nil || got["climbedM"] == nil {
		t.Errorf("the saved ride's answer carries no distance or climbing: %v", got)
	}
}

// A ride with no road still says how it was ridden, and keeps a weight the
// rider set — never a default one (ADR-0048).
func TestARideWithNoRoadKeepsItsModeAndASetWeight(t *testing.T) {
	h := setup(t)
	if _, err := h.store.Pool.Exec(t.Context(),
		`update users set weight_kg = 68, weight_source = 'manual' where id = $1`, h.users.ByToken["bob"].ID); err != nil {
		t.Fatal(err)
	}
	u, err := h.store.Queries.GetUser(t.Context(), h.users.ByToken["bob"].ID)
	if err != nil {
		t.Fatal(err)
	}
	h.users.ByToken["bob"] = u
	id := h.save(t, "bob", 120, 200)
	s := readSummary(t, h, id)
	if s.mode == nil || *s.mode != "workout" || s.timeable == nil || *s.timeable {
		t.Errorf("mode %v, timeable %v; want an untimed workout", s.mode, s.timeable)
	}
	if s.routeID != nil || s.distanceM != nil || s.fromM != nil {
		t.Errorf("a ride with no road kept road columns: %+v", s)
	}
	if s.weightKg == nil || *s.weightKg != 68 {
		t.Errorf("weight %v, want the 68 kg bob set", s.weightKg)
	}
}

func TestARideOnSomeoneElsesRouteIsRefused(t *testing.T) {
	h := setup(t)
	bobs, _ := storeRoute(t, h, "bob")
	for _, tc := range []struct {
		route string
		want  int
	}{
		{bobs, http.StatusNotFound},
		{"not-a-uuid", http.StatusBadRequest},
		{"00000000-0000-0000-0000-000000000000", http.StatusNotFound},
	} {
		status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", freeRideOn(tc.route, 8, stats.DriveSIM))
		if status != tc.want || got["field"] != "routeId" {
			t.Errorf("route %q: %d %v, want %d on routeId", tc.route, status, got, tc.want)
		}
	}
}

// How the trainer was driven decides the ride's time (#3516, ADR-0074):
// "Don't make me shift" keeps the ride and never times it, a road ride that
// does not say keeps it as not known rather than a guess, and a drive this
// app has no word for is refused.
func TestARoadRidesTimeFollowsHowTheTrainerWasDriven(t *testing.T) {
	h := setup(t)
	routeID, _ := storeRoute(t, h, "alice")
	for _, c := range []struct {
		drive string
		want  *bool
	}{
		{stats.DriveGears, new(true)},
		{stats.DriveERGByRoad, new(false)},
		{"", nil},
	} {
		status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", freeRideOn(routeID, 8, c.drive))
		if status != http.StatusCreated {
			t.Fatalf("drive %q: %d %v", c.drive, status, got)
		}
		id, _ := got["id"].(string)
		if s := readSummary(t, h, id); (s.timeable == nil) != (c.want == nil) || s.timeable != nil && *s.timeable != *c.want {
			t.Errorf("drive %q: timeable %v, want %v", c.drive, deref(s.timeable), deref(c.want))
		}
	}
	if status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", freeRideOn(routeID, 8, "autopilot")); status != http.StatusBadRequest || got["field"] != "drive" {
		t.Errorf("an unknown drive: %d %v, want 400 on drive", status, got)
	}
}

// deref prints a *bool as the column reads: true, false, or null.
func deref(b *bool) string {
	if b == nil {
		return "null"
	}
	return fmt.Sprint(*b)
}
