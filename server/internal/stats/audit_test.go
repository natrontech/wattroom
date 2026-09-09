package stats

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The saved score drops the seconds SPEC calls stopped — cadence under 5 rpm
// AND power under 20 W — the way the live meter does; it used to drop only
// 0 W, so a soft-pedalled second was dropped live and a miss once saved
// (audit 2026-09-09).
func TestExecutionExcludesStoppedSecondsLikeTheLiveMeter(t *testing.T) {
	stopped := make([]protocol.RiderMetrics, 30)
	for i := range stopped {
		stopped[i] = protocol.RiderMetrics{Watts: 10, Cadence: 0}
	}
	samples := ride(flat(1, 60), flat(200, 30), flat(100, 30), stopped, flat(100, 30))
	got, _, err := Execution(workoutJSON, 200, samples)
	if err != nil || got != 1 {
		t.Fatalf("a 10 W / 0 rpm block scored as misses: %v (%v)", got, err)
	}
	spinning := make([]protocol.RiderMetrics, 30)
	for i := range spinning {
		spinning[i] = protocol.RiderMetrics{Watts: 10, Cadence: 60}
	}
	got, _, err = Execution(workoutJSON, 200, ride(flat(1, 60), flat(200, 30), flat(100, 30), spinning, flat(100, 30)))
	if err != nil || got == 1 {
		t.Fatalf("a 10 W block with cadence was not scored: %v (%v)", got, err)
	}
}

// The ±10 W floor (docs/SPEC.md: beginners at 100 W targets need it): at a
// 60 W target the 5 % band would be 3 W; the floor makes it 10.
func TestExecutionBandFloor(t *testing.T) {
	low := `{"name":"t","steps":[{"type":"steady","seconds":30,"target":0.3}]}`
	in, _, err := Execution(low, 200, flat(66, 30))
	if err != nil || in != 1 {
		t.Fatalf("66 W against a 60 W target: %v (%v), want inside the floor", in, err)
	}
	out, _, err := Execution(low, 200, flat(72, 30))
	if err != nil || out != 0 {
		t.Fatalf("72 W against a 60 W target: %v (%v), want outside", out, err)
	}
}

// The three-rider field is riders who rode: one live power meter beside two
// dead ones used to take Diesel, Hammer and Lanterne Rouge at once.
func TestOneLiveRiderWinsNothing(t *testing.T) {
	dead := func(id string, join int) RiderResult {
		return RiderResult{UserID: id, JoinOrder: join, Completed: true, Scored: true}
	}
	got := Medals([]RiderResult{result("alone", 0, 0.95, 0.1, 6.0), dead("d1", 1), dead("d2", 2)})
	if len(got) != 0 {
		t.Fatalf("a field of one was awarded %v", got)
	}
}
