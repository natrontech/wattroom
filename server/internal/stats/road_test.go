package stats

import (
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

func storedRoad(t *testing.T, lengthM, gain float64) road.Road {
	t.Helper()
	r, err := road.UnpackRoad(testx.FlatRoad(lengthM, gain))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// seconds of `watts`, the client's metres stepping `clientMps` from `from`.
func rodeAt(seconds, watts int, from, clientMps float64) []protocol.RiderMetrics {
	out := make([]protocol.RiderMetrics, seconds)
	for i := range out {
		out[i] = protocol.RiderMetrics{Watts: watts, M: from + clientMps*float64(i+1)}
	}
	return out
}

// The replay is the one pace model stepped along the road's own grade, from
// where the ride started (#3053): its figure is the record.
func TestReplayRoadIsThePaceAlongTheRoad(t *testing.T) {
	r := storedRoad(t, 20_000, 0)
	mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	got := ReplayRoad(r, rodeAt(600, 225, 3000, 9), mass)

	p := road.Pace{}
	for range 600 {
		p.Step(225, 0, mass, protocol.PaceDefaultCdA, 0)
	}
	if got.FromM != 3000+9 || math.Abs(got.DistanceM-p.Distance) > 1e-9 || got.ClimbedM != 0 {
		t.Fatalf("replayed %+v, want from 3009 m, %.3f m, climbing nothing", got, p.Distance)
	}
}

func TestReplayRoadStopsAtTheRoadsEnd(t *testing.T) {
	r := storedRoad(t, 2000, 40)
	got := ReplayRoad(r, rodeAt(3600, 300, 500, 9), 83)
	if math.Abs(got.DistanceM-(2000-509)) > 1e-9 {
		t.Fatalf("distance %.2f m, want the 1491 m left of the road", got.DistanceM)
	}
	if want := 40 * (2000 - 509) / 2000.0; math.Abs(got.ClimbedM-want) > 0.01 {
		t.Fatalf("climbed %.2f m, want %.2f over the metres ridden", got.ClimbedM, want)
	}
}

// The client's own metres are compared, never kept: the gap is how far they
// part from the replay, and the save logs one past ReplayGapLogged.
func TestReplayRoadMeasuresTheClientsGap(t *testing.T) {
	r := storedRoad(t, 20_000, 0)
	mass := 83.0
	honest := ReplayRoad(r, rodeAt(600, 225, 0, 0), mass)
	perSecond := honest.DistanceM / 600
	if got := ReplayRoad(r, rodeAt(600, 225, 0, perSecond), mass).Gap; got > 0.002 {
		t.Errorf("a client that rode the replay's pace parts by %.4f", got)
	}
	if got := ReplayRoad(r, rodeAt(600, 225, 0, perSecond*1.05), mass).Gap; got < ReplayGapLogged {
		t.Errorf("a client 5 %% ahead parts by only %.4f", got)
	}
}

func TestRideMode(t *testing.T) {
	steps := `{"steps":[{"type":"steady","seconds":60,"target":0.6}]}`
	empty := `{"name":"Free ride","unscored":true,"steps":[]}`
	for _, c := range []struct {
		json    string
		session bool
		want    string
	}{
		{steps, false, "workout"},
		{steps, true, "workout"},
		{empty, false, "free"},
		{empty, true, "game"},
	} {
		if got := RideMode(c.json, c.session); got != c.want {
			t.Errorf("RideMode(%s, session %v) = %q, want %q", c.json, c.session, got, c.want)
		}
	}
}

// ADR-0074's table: only a rider's own watts on a road make a time, and not
// a mostly-sheltered one.
func TestTimeable(t *testing.T) {
	for _, c := range []struct {
		mode    string
		onRoad  bool
		shelter float64
		want    bool
	}{
		{"free", true, 0, true},
		{"free", true, protocol.MaxTimeableShelter, true},
		{"free", true, protocol.MaxTimeableShelter + 0.001, false},
		{"free", false, 0, false},
		{"workout", true, 0, false},
		{"game", false, 0, false},
	} {
		if got := Timeable(c.mode, c.onRoad, c.shelter); got != c.want {
			t.Errorf("Timeable(%q, road %v, shelter %v) = %v, want %v", c.mode, c.onRoad, c.shelter, got, c.want)
		}
	}
}

func TestWeightThatDayIsOnlyASetOne(t *testing.T) {
	manual, dflt := "manual", "default"
	if got := WeightThatDay(db.User{WeightKg: 70, WeightSource: &dflt}); got != nil {
		t.Errorf("a default weight kept %d", *got)
	}
	if got := WeightThatDay(db.User{WeightKg: 75}); got != nil {
		t.Errorf("an unknown source kept %d", *got)
	}
	if got := WeightThatDay(db.User{WeightKg: 68, WeightSource: &manual}); got == nil || *got != 68 {
		t.Errorf("a set weight kept %v, want 68", got)
	}
}
