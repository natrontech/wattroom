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
	// What the ride did after its first pass (#4193): the metres of each
	// later second, and the distance they add to distance_m.
	after  []float64
	extraM int
}

// seedRide stores one ride of a road the way a save does, with a metre on
// every sample, where its second began — only the columns the attempts read.
func seedRide(t *testing.T, h *harness, r ride) string {
	t.Helper()
	seconds := int(float64(r.distanceM) / r.mps)
	samples := make([]protocol.RiderMetrics, seconds, seconds+len(r.after))
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 250, M: float64(r.fromM) + r.mps*float64(i)}
	}
	for _, m := range r.after {
		samples = append(samples, protocol.RiderMetrics{Watts: 250, M: m})
	}
	seconds = len(samples)
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
		r.who, time.Now().Add(-r.ago), seconds, blob.Bytes(), r.key, r.roadH, r.timeable, r.fromM, r.distanceM+r.extraM,
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
	if len(attempts) != 1 || entry(attempts, 0)["rideId"] != mine {
		t.Errorf("alice's attempts are %v, want her one ride", attempts)
	}
}

// Your best is the ride that reached the road's end first (#4193), not the
// one with the fewest seconds saved: a faster ride that rode on past the end,
// or turned back and rode a lap more, is still your best.
func TestTheGhostIsTheFastestToTheRoadsEnd(t *testing.T) {
	at := func(m float64, n int) []float64 {
		out := make([]float64, n)
		for i := range out {
			out[i] = m
		}
		return out
	}
	back := make([]float64, 100) // back down the road at 6 m/s
	for i := range back {
		back[i] = 3000 - 6*float64(i)
	}
	for name, tc := range map[string]ride{
		// 3 km at 6 m/s: 500 s, then the road-end sheet's 10 s and 20 more.
		"rode on past the end":  {mps: 6, after: at(3000, 30)},
		"turned back for a lap": {mps: 6, after: back, extraM: 594},
	} {
		t.Run(name, func(t *testing.T) {
			h := setup(t, nil)
			alice := h.users.ByToken["alice"].ID
			route, key := climbingRoute(t, h, alice)
			// 3 km at 5.9 m/s, saved on arrival: 508 s.
			seedRide(t, h, ride{who: alice, key: key, roadH: key, timeable: true, distanceM: 3000, mps: 5.9, ago: 48 * time.Hour})
			tc.who, tc.key, tc.roadH, tc.timeable, tc.distanceM, tc.ago = alice, key, key, true, 3000, time.Hour
			faster := seedRide(t, h, tc)

			_, ghost := h.call(t, "alice", http.MethodGet, "/api/routes/"+route+"/ghost", nil)
			if ghost["rideId"] != faster || ghost["best"] != true {
				t.Errorf("alice races %v (best %v), want her 500 s ride %s", ghost["rideId"], ghost["best"], faster)
			}
		})
	}
}

// A ride's time on the road is its first pass from the start to the end
// (#4193), whatever it did after.
func TestRoadTimeIsTheFirstPassToTheEnd(t *testing.T) {
	for name, tc := range map[string]struct {
		metres    []float64
		distanceM float64
		want      int
		ok        bool
	}{
		"saved on arrival":                  {[]float64{0, 5, 10, 15}, 20, 4, true},
		"rode on past the end":              {[]float64{0, 5, 10, 15, 20, 20, 20}, 20, 4, true},
		"rode it again":                     {[]float64{0, 5, 10, 15, 20, 0, 5}, 25, 4, true},
		"rode back the way it came":         {[]float64{0, 5, 10, 15, 20, 15, 10}, 30, 4, true},
		"waited at the start":               {[]float64{0, 0, 0, 5, 10, 15}, 20, 4, true},
		"an older snapshot, a little short": {[]float64{0, 5, 10, 15}, 19.9, 4, true},
		"stopped short of the end":          {[]float64{0, 5, 10}, 15, 0, false},
		"no samples":                        {nil, 0, 0, false},
	} {
		t.Run(name, func(t *testing.T) {
			got, ok := roadTime(tc.metres, tc.distanceM, 20)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("roadTime = %d, %v; want %d, %v", got, ok, tc.want, tc.ok)
			}
		})
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
	for i := range attempts {
		kind, _ := entry(attempts, i)["kind"].(string)
		kinds = append(kinds, kind)
	}
	if len(kinds) != 3 || kinds[0] != "together" || kinds[1] != "timed" || kinds[2] != "timed" {
		t.Errorf("kinds newest first are %v, want together, timed, timed", kinds)
	}
	bests, _ := got["climbBests"].([]any)
	if len(bests) != 1 {
		t.Fatalf("climb bests: %v", bests)
	}
	best := entry(bests, 0)
	// 1 km at 8 m/s: 125 s — the session's faster pass timed nothing.
	if best["rideId"] != fast || best["seconds"] != float64(125) {
		t.Errorf("the climb's best is %v, want %s in 125 s (not %s)", best, fast, slow)
	}
}

// entry is one object of a JSON array the harness decoded; nil when it is not one.
func entry(list []any, i int) map[string]any {
	if i >= len(list) {
		return nil
	}
	m, _ := list[i].(map[string]any)
	return m
}

// A climb is timed from where the ride crossed its foot to where it crossed
// its top (#3635): from the first sample when a route begins at the foot — a
// climb-only import — and not at all when the ride began past it.
func TestTimeUpACrossingOfTheClimb(t *testing.T) {
	for name, tc := range map[string]struct {
		metres   []float64
		from, to float64
		want     int
		ok       bool
	}{
		"a climb from the road's first metre":       {[]float64{0, 5, 10, 15, 20}, 0, 20, 4, true},
		"a rider waiting at the foot starts moving": {[]float64{0, 0, 0, 5, 10}, 0, 10, 2, true},
		"a climb along the road, between samples":   {[]float64{0, 4, 8, 12, 16}, 6, 14, 2, true},
		"a ride begun past the foot":                {[]float64{5, 10, 15, 20}, 0, 20, 0, false},
		"a ride that never reached the top":         {[]float64{0, 5, 10}, 0, 20, 0, false},
		"no samples":                                {nil, 0, 20, 0, false},
	} {
		t.Run(name, func(t *testing.T) {
			got, ok := timeUp(tc.metres, tc.from, tc.to)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("timeUp = %d, %v; want %d, %v", got, ok, tc.want, tc.ok)
			}
		})
	}
}
