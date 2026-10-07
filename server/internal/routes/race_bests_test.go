package routes

import (
	"context"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// #3722's acceptance: a race on a road saves each rider's ride with the
// road, timeable when their own watts moved them, and their climb shows in
// the road's per-climb bests — while a "Don't make me shift" race ride is
// saved and times nothing, and a route deleted since saves the ride by its
// road alone.
func TestARaceTimeCountsTowardTheClimbsBest(t *testing.T) {
	h := setup(t, nil)
	alice := h.users.ByToken["alice"]
	route, key := climbingRoute(t, h, alice.ID)
	saver := stats.NewSaver(h.store, slog.New(slog.DiscardHandler))
	race := `{"name":"Race","unscored":true,"race":true,"steps":[]}`

	// One race of the 3 km road at a steady pace, saved the way the hub
	// hands it over: a metre on every second, in the stored road's metres.
	ride := func(routeID string, mps float64, ergByRoad bool, ago time.Duration) (pgtype.UUID, time.Time) {
		t.Helper()
		samples := make([]protocol.RiderMetrics, int(3000/mps))
		for i := range samples {
			samples[i] = protocol.RiderMetrics{Watts: 250, Cadence: 90, Seq: i + 1, Clock: i + 1, M: mps * float64(i+1)}
		}
		started := time.Now().Add(-ago).Truncate(time.Second)
		saver.SaveSession(t.Context(), uuid.NewString(), uuid.NewString(), "Race", race, started, []hub.RiderRecord{{
			Rider: protocol.Rider{ID: store.UUIDString(alice.ID), Name: "alice", FtpWatts: 250, WeightKg: 70}, Samples: samples,
			Road: &hub.RecordRoad{RouteID: routeID, RoadHash: key, DistanceM: 3000, ClimbedM: 80, ErgByRoad: ergByRoad},
		}})
		var id pgtype.UUID
		if err := h.store.Pool.QueryRow(t.Context(), `select id from rides where user_id = $1 and started_at = $2`, alice.ID, started).Scan(&id); err != nil {
			t.Fatalf("the race ride was not saved: %v", err)
		}
		return id, started
	}
	columns := func(id pgtype.UUID) (routeID *pgtype.UUID, routeKey, mode *string, timeable *bool, distance *int32) {
		t.Helper()
		var rid pgtype.UUID
		if err := h.store.Pool.QueryRow(t.Context(),
			`select route_id, route_key, ride_mode, timeable, distance_m from rides where id = $1`, id).
			Scan(&rid, &routeKey, &mode, &timeable, &distance); err != nil {
			t.Fatal(err)
		}
		if rid.Valid {
			routeID = &rid
		}
		return routeID, routeKey, mode, timeable, distance
	}

	timed, _ := ride(route, 8, false, 3*time.Hour)
	held, _ := ride(route, 10, true, 2*time.Hour)
	gone, _ := ride(uuid.NewString(), 12, false, time.Hour)

	if rid, rk, mode, tm, d := columns(timed); rid == nil || store.UUIDString(*rid) != route || rk == nil || *rk != key ||
		mode == nil || *mode != "race" || tm == nil || !*tm || d == nil || *d != 3000 {
		t.Fatalf("the race ride: route %v, key %v, mode %v, timeable %v, distance %v", rid, rk, mode, tm, d)
	}
	if _, _, _, tm, _ := columns(held); tm == nil || *tm {
		t.Errorf("a Don't-make-me-shift race ride is timeable: %v", tm)
	}
	if rid, rk, _, _, _ := columns(gone); rid != nil || rk == nil || *rk != key {
		t.Errorf("a ride of a route deleted since: route %v, key %v", rid, rk)
	}

	_, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+route+"/attempts", nil)
	bests, _ := got["climbBests"].([]any)
	if len(bests) != 1 {
		t.Fatalf("climb bests: %v", bests)
	}
	// 1 km at 12 m/s is 83 s, and it counts: the road is the same road by
	// its hash. The held ride's 100 s at 10 m/s times nothing.
	if best := entry(bests, 0); best["rideId"] != store.UUIDString(gone) || best["seconds"] != float64(83) {
		t.Errorf("the climb's best is %v, want the 12 m/s race in 83 s", best)
	}
}

// #3738's acceptance: a bunch session's ride is saved with its road — route,
// key, distance and climb — and times nothing, however fast it went: it shows
// among the road's attempts as ridden together, and never as a climb's best.
func TestABunchRideKeepsItsRoadAndTimesNothing(t *testing.T) {
	h := setup(t, nil)
	alice := h.users.ByToken["alice"]
	route, key := climbingRoute(t, h, alice.ID)
	saver := stats.NewSaver(h.store, slog.New(slog.DiscardHandler))
	samples := make([]protocol.RiderMetrics, 300)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 250, Cadence: 90, Seq: i + 1, Clock: i + 1, M: 10 * float64(i+1)}
	}
	// A crew's voice channel, so the ride is saved as the session's.
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "Bunch", OwnerID: alice.ID, Code: testx.CrewCode()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	channel, err := h.store.Queries.CreateChannel(t.Context(), db.CreateChannelParams{CrewID: crew.ID, Kind: "voice", Name: "Bunch", MaxChannels: 10})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now().Add(-time.Hour).Truncate(time.Second)
	saver.SaveSession(t.Context(), store.UUIDString(channel.ID), uuid.NewString(), "Road steps",
		`{"name":"Road steps","steps":[{"type":"road","seconds":300}]}`, started, []hub.RiderRecord{{
			Rider: protocol.Rider{ID: store.UUIDString(alice.ID), Name: "alice", FtpWatts: 250, WeightKg: 70}, Samples: samples,
			Road: &hub.RecordRoad{RouteID: route, RoadHash: key, DistanceM: 3000, ClimbedM: 80, Towed: true},
		}})
	var routeKey *string
	var timeable *bool
	var distance, climbed *int32
	var shelter *float32
	if err := h.store.Pool.QueryRow(t.Context(),
		`select route_key, timeable, distance_m, climbed_m, mean_shelter from rides where user_id = $1 and started_at = $2`, alice.ID, started).
		Scan(&routeKey, &timeable, &distance, &climbed, &shelter); err != nil {
		t.Fatalf("the bunch ride was not saved: %v", err)
	}
	if routeKey == nil || *routeKey != key || distance == nil || *distance != 3000 || climbed == nil || *climbed != 80 ||
		timeable == nil || *timeable || shelter != nil {
		t.Fatalf("the bunch ride: key %v, distance %v, climbed %v, timeable %v, shelter %v", routeKey, distance, climbed, timeable, shelter)
	}
	_, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+route+"/attempts", nil)
	attempts, _ := got["attempts"].([]any)
	if len(attempts) != 1 || entry(attempts, 0)["kind"] != "together" {
		t.Errorf("the attempts: %v, want the one ride, ridden together", attempts)
	}
	if bests, _ := got["climbBests"].([]any); len(bests) != 0 {
		t.Errorf("a towed ride timed a climb: %v", bests)
	}
}
