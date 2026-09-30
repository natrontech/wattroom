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
	got := ReplayRoad(r, rodeAt(600, 225, 3000, 9), nil, mass)

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
	got := ReplayRoad(r, rodeAt(3600, 300, 500, 9), nil, 83)
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
	honest := ReplayRoad(r, rodeAt(600, 225, 0, 0), nil, mass)
	perSecond := honest.DistanceM / 600
	if got := ReplayRoad(r, rodeAt(600, 225, 0, perSecond), nil, mass).Gap; got > 0.002 {
		t.Errorf("a client that rode the replay's pace parts by %.4f", got)
	}
	if got := ReplayRoad(r, rodeAt(600, 225, 0, perSecond*1.05), nil, mass).Gap; got < ReplayGapLogged {
		t.Errorf("a client 5 %% ahead parts by only %.4f", got)
	}
}

// A road ride with laps (#3598): each lap rides from where its first sample
// stood, its own way, and the ride keeps the sum — distance, and climbing
// counted the way each lap was ridden. A road 2 km long, 2 % up: an hour at
// 300 W reaches its end, so every lap here rides to one.
func TestARoadRideWithLapsRidesEachLapItsWay(t *testing.T) {
	up := storedRoad(t, 2000, 40)
	down := turnedRound(up)
	lapped := func(first, second []protocol.RiderMetrics) []protocol.RiderMetrics {
		return append(append([]protocol.RiderMetrics{}, first...), second...)
	}
	const lap = 3600
	for _, c := range []struct {
		name              string
		road              road.Road
		samples           []protocol.RiderMetrics
		laps              []Lap
		from, dist, climb float64
	}{
		{
			// Out to the top and back down the way you came: the climb once.
			"an out-and-back up the hill", up,
			lapped(rodeAt(lap, 300, 0, 9), rodeAt(lap, 300, 2000, -9)),
			[]Lap{{Start: 0}, {Start: lap, Reverse: true}},
			9, 1991 + 1991, 40 * 1991 / 2000.0,
		},
		{
			// Down the stored road, then back up it: the return is the climb.
			"an out-and-back down the hill", down,
			lapped(rodeAt(lap, 300, 0, 9), rodeAt(lap, 300, 2000, -9)),
			[]Lap{{Start: 0}, {Start: lap, Reverse: true}},
			9, 1991 + 1991, 40 * 1991 / 2000.0,
		},
		{
			// Ride it again from the start: the climb twice.
			"a two-lap repeat", up,
			lapped(rodeAt(lap, 300, 0, 9), rodeAt(lap, 300, 0, 9)),
			[]Lap{{Start: 0}, {Start: lap}},
			9, 2 * 1991, 2 * 40 * 1991 / 2000.0,
		},
	} {
		got := ReplayRoad(c.road, c.samples, c.laps, 83)
		if got.FromM != c.from || math.Abs(got.DistanceM-c.dist) > 1e-6 || math.Abs(got.ClimbedM-c.climb) > 0.01 {
			t.Errorf("%s: from %v m, %.2f m, climbing %.2f m; want from %v, %.2f m, climbing %.2f m",
				c.name, got.FromM, got.DistanceM, got.ClimbedM, c.from, c.dist, c.climb)
		}
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

// ADR-0074's table (#3516): a time is timed when the grade drove the trainer
// — SIM or gears — on a free ride or on road steps alone, and not a mostly
// sheltered one; "Don't make me shift" never is, a workout with a target in
// it measures the workout, and a road ride that does not say how it was
// driven is not known (nil), never a guess.
func TestTimeable(t *testing.T) {
	const (
		free         = `{"name":"Free","unscored":true,"steps":[]}`
		erg          = `{"name":"Road ERG","steps":[{"type":"steady","seconds":600,"target":0.8}]}`
		steps        = `{"name":"Road steps","steps":[{"type":"road","seconds":600},{"type":"repeat","times":2,"steps":[{"type":"road","seconds":300}]}]}`
		mixed        = `{"name":"Mixed","steps":[{"type":"road","seconds":600},{"type":"steady","seconds":300,"target":0.6}]}`
		unknown      = "unknown"
		yes, untimed = "yes", "no"
	)
	for _, c := range []struct {
		name, mode, workout string
		onRoad              bool
		drive               string
		shelter             float64
		want                string
	}{
		{"a free ride on a road in SIM", "free", free, true, DriveSIM, 0, yes},
		{"through gears, like any SIM ride", "free", free, true, DriveGears, 0, yes},
		{"Don't make me shift: WattRoom chose the watts", "free", free, true, DriveERGByRoad, 0, untimed},
		{"a road ride that does not say", "free", free, true, "", 0, unknown},
		{"sheltered to the limit", "free", free, true, DriveSIM, protocol.MaxTimeableShelter, yes},
		{"sheltered past it", "free", free, true, DriveSIM, protocol.MaxTimeableShelter + 0.001, untimed},
		{"no road, no time", "free", free, false, DriveSIM, 0, untimed},
		{"a solo road step", "workout", steps, true, DriveSIM, 0, yes},
		{"road steps by ERG", "workout", steps, true, DriveERGByRoad, 0, untimed},
		{"road steps that do not say", "workout", steps, true, "", 0, unknown},
		{"an ERG road workout measures the workout", "workout", erg, true, DriveSIM, 0, untimed},
		{"a target among road steps", "workout", mixed, true, DriveSIM, 0, untimed},
		{"a session's game", "game", free, false, "", 0, untimed},
	} {
		got := unknown
		if v := Timeable(c.mode, c.workout, c.onRoad, c.drive, c.shelter); v != nil {
			got = map[bool]string{true: yes, false: untimed}[*v]
		}
		if got != c.want {
			t.Errorf("%s: timed %s, want %s", c.name, got, c.want)
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
