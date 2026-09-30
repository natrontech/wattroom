package routes

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// climbingRoute is a 3 km road with one classed climb from 1 km to 2 km.
func climbingRoute(t *testing.T, h *harness, owner pgtype.UUID) (string, string) {
	t.Helper()
	key := "hill-" + store.UUIDString(owner)
	row, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
		OwnerID: owner, Src: "gpx", Name: "Home hill", GenName: "Road · 3.0 km · 80 m",
		Road: testx.FlatRoad(3000, 80), RoadHash: key, LengthM: 3000, GainM: 80,
		Climbs: []byte(`[{"startM":1000,"topM":2000,"gainM":80,"cls":"IV"}]`), EleSource: "file",
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	return store.UUIDString(row.ID), key
}

type ride struct {
	who               pgtype.UUID
	key, roadH        string
	timeable, session bool
	fromM, distanceM  int
	ago               time.Duration
	mps               float64 // a steady pace, so the ride covers distanceM
}

// seedRide stores one ride of a road the way a save does, with a metre on
// every sample — only the columns the attempts read.
func seedRide(t *testing.T, h *harness, r ride) string {
	t.Helper()
	seconds := int(float64(r.distanceM) / r.mps)
	samples := make([]protocol.RiderMetrics, seconds)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 250, M: float64(r.fromM) + r.mps*float64(i+1)}
	}
	var blob bytes.Buffer
	zw := gzip.NewWriter(&blob)
	if err := json.NewEncoder(zw).Encode(samples); err != nil {
		t.Fatal(err)
	}
	_ = zw.Close()
	var id pgtype.UUID
	if err := h.store.Pool.QueryRow(t.Context(),
		`insert into rides (user_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples,
		                    route_key, road_h, timeable, from_m, distance_m, ride_mode)
		 values ($1, 'Road', $2, $3, 250, 100, 0, 250, $4, $5, $6, $7, $8, $9, $10) returning id`,
		r.who, time.Now().Add(-r.ago), seconds, blob.Bytes(), r.key, r.roadH, r.timeable, r.fromM, r.distanceM,
		map[bool]string{true: "bunch", false: "free"}[r.session]).Scan(&id); err != nil {
		t.Fatalf("seed ride: %v", err)
	}
	return store.UUIDString(id)
}

// A road's rides are its owner's (#3033): someone else is told so, and a
// route that is not there reads as absent.
func TestARoutesAttemptsAreItsOwners(t *testing.T) {
	h := setup(t, nil)
	route, _ := climbingRoute(t, h, h.users.ByToken["alice"].ID)
	for _, path := range []string{"/attempts", "/ghost"} {
		if status, _ := h.call(t, "bob", http.MethodGet, "/api/routes/"+route+path, nil); status != http.StatusForbidden {
			t.Errorf("bob reading alice's %s: %d, want 403", path, status)
		}
		if status, _ := h.call(t, "alice", http.MethodGet, "/api/routes/9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a"+path, nil); status != http.StatusNotFound {
			t.Errorf("a route that is not there, %s: %d, want 404", path, status)
		}
	}
}

// Another rider's ride of the same road is never an attempt and never a
// ghost (#3033) — not even a faster one saved under the road's own key.
func TestAnotherRidersRideIsNeverYourGhost(t *testing.T) {
	h := setup(t, nil)
	alice, bob := h.users.ByToken["alice"].ID, h.users.ByToken["bob"].ID
	route, key := climbingRoute(t, h, alice)
	mine := seedRide(t, h, ride{who: alice, key: key, roadH: key, timeable: true, distanceM: 3000, mps: 6, ago: 48 * time.Hour})
	theirs := seedRide(t, h, ride{who: bob, key: key, roadH: key, timeable: true, distanceM: 3000, mps: 12, ago: time.Hour})

	_, ghost := h.call(t, "alice", http.MethodGet, "/api/routes/"+route+"/ghost", nil)
	if ghost["rideId"] != mine {
		t.Errorf("alice races %v, want her own %s and never bob's %s", ghost["rideId"], mine, theirs)
	}
	_, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+route+"/attempts", nil)
	attempts, _ := got["attempts"].([]any)
	if len(attempts) != 1 || attempts[0].(map[string]any)["rideId"] != mine {
		t.Errorf("alice's attempts are %v, want her one ride", attempts)
	}
}

// The attempts say how each ride was ridden, and the climb's best is the
// fastest timeable pass up it.
func TestAttemptsAndTheClimbsBest(t *testing.T) {
	h := setup(t, nil)
	alice := h.users.ByToken["alice"].ID
	route, key := climbingRoute(t, h, alice)
	slow := seedRide(t, h, ride{who: alice, key: key, roadH: key, timeable: true, distanceM: 3000, mps: 5, ago: 72 * time.Hour})
	fast := seedRide(t, h, ride{who: alice, key: key, roadH: key, timeable: true, distanceM: 3000, mps: 8, ago: 48 * time.Hour})
	seedRide(t, h, ride{who: alice, key: key, roadH: key, session: true, distanceM: 3000, mps: 10, ago: 24 * time.Hour})

	status, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+route+"/attempts", nil)
	if status != http.StatusOK {
		t.Fatalf("attempts: %d %v", status, got)
	}
	attempts, _ := got["attempts"].([]any)
	var kinds []string
	for _, a := range attempts {
		kinds = append(kinds, a.(map[string]any)["kind"].(string))
	}
	if len(kinds) != 3 || kinds[0] != "together" || kinds[1] != "timed" || kinds[2] != "timed" {
		t.Errorf("kinds newest first are %v, want together, timed, timed", kinds)
	}
	bests, _ := got["climbBests"].([]any)
	if len(bests) != 1 {
		t.Fatalf("climb bests: %v", bests)
	}
	best := bests[0].(map[string]any)
	// 1 km at 8 m/s: 125 s — the session's faster pass timed nothing.
	if best["rideId"] != fast || best["seconds"] != float64(125) {
		t.Errorf("the climb's best is %v, want %s in 125 s (not %s)", best, fast, slow)
	}
}
