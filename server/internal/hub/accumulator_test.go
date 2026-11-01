package hub

import (
	"math/rand/v2"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func readings(seconds ...int) []protocol.RiderMetrics {
	out := make([]protocol.RiderMetrics, len(seconds))
	for i, s := range seconds {
		out[i] = protocol.RiderMetrics{Seq: i + 1, Watts: 100 + 10*i, Clock: s}
	}
	return out
}

func TestBridgeSilences(t *testing.T) {
	tests := []struct {
		name    string
		seconds []int
		want    []int
	}{
		{"every second", []int{0, 1, 2}, []int{0, 1, 2}},
		{"one late reading", []int{0, 1, 3, 4}, []int{0, 1, 2, 3, 4}},
		{"longest bridged silence", []int{0, 4}, []int{0, 1, 2, 3, 4}},
		{"a dropout stays a gap", []int{0, 5}, []int{0, 5}},
		{"no clock at all", []int{0, 0, 0}, []int{0, 0, 0}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got []int
			for _, m := range bridgeSilences(readings(tc.seconds...)) {
				got = append(got, m.Clock)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("clocks = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("clocks = %v, want %v", got, tc.want)
				}
			}
		})
	}
}

// A bridged second is drawn between its two neighbours and says it was not
// measured; it invents no heart rate, cadence or road position.
func TestBridgedSecondInventsNothing(t *testing.T) {
	prev := protocol.RiderMetrics{Watts: 100, HR: 140, Cadence: 90, Bias: 1.1, M: 1000, Alt: 20, Clock: 10}
	next := protocol.RiderMetrics{Watts: 200, HR: 0, Cadence: 80, M: 1010, Alt: 22, Clock: 12}
	got := bridgeSilences([]protocol.RiderMetrics{prev, next})
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	mid := got[1]
	if mid.Clock != 11 || mid.Watts != 150 || mid.Cadence != 85 || mid.M != 1005 || mid.Alt != 21 || mid.Bias != 1.1 {
		t.Fatalf("bridged = %+v, want the midpoint of its neighbours", mid)
	}
	if mid.HR != 0 {
		t.Fatalf("HR = %d, want none: the strap reported only one side", mid.HR)
	}
	if !mid.Released {
		t.Fatal("a bridged second must be unscored")
	}
	back := bridgeSilences([]protocol.RiderMetrics{prev, {Watts: 90, M: 500, Clock: 12}})
	if back[1].M != 0 || back[1].Alt != 0 {
		t.Fatalf("a road position that moves backwards is not bridged: %+v", back[1])
	}
}

// A reconnect's replay of the real reading wins over any bridge: the record
// holds only what was measured, and the bridge is drawn when it is read.
func TestReplayStillLandsWhereASecondWasBridged(t *testing.T) {
	a := newAccumulator()
	a.add("r", protocol.RiderMetrics{Seq: 1, Watts: 100}, nil, 0, 0)
	a.add("r", protocol.RiderMetrics{Seq: 3, Watts: 300}, nil, 0, 2)
	if got := a.byRider["r"].inOrder(); len(got) != 3 || got[1].Watts != 200 {
		t.Fatalf("before the replay = %+v, want 200 W bridged at second 1", got)
	}
	a.replay("r", protocol.RiderMetrics{Seq: 2, Watts: 180, Clock: 1})
	if got := a.byRider["r"].inOrder(); len(got) != 3 || got[1].Watts != 180 || got[1].Released {
		t.Fatalf("after the replay = %+v, want the measured 180 W", got)
	}
}

// trainerRide feeds the record what a trainer notifying every `period` would, each
// notification arriving a random delay late, binned by the room's clock as
// setMetrics does. It returns the true length and the record's.
func trainerRide(period time.Duration, jitter time.Duration, stalls bool, seconds int, seed uint64) (truth, raw, bridged int, out []protocol.RiderMetrics) {
	rng := rand.New(rand.NewPCG(seed, seed))
	a := newAccumulator()
	var at time.Duration
	var seq int
	for {
		at += period
		if stalls && rng.IntN(100) == 0 {
			at += time.Duration(1+rng.IntN(2)) * time.Second
		}
		arrived := at + time.Duration(rng.Int64N(int64(jitter)+1))
		second := int(arrived / time.Second)
		if second >= seconds {
			break
		}
		seq++
		a.add("r", protocol.RiderMetrics{Seq: seq, Watts: 180 + rng.IntN(40), HR: 150, Cadence: 90}, nil, 0, second)
	}
	rec := a.byRider["r"]
	out = rec.inOrder()
	return seconds, len(rec.samples), len(out), out
}

// The case the issue came from: a 70-minute ride that lost minutes.
func TestRideKeepsItsLengthUnderJitterAndDrift(t *testing.T) {
	const seconds = 70 * 60
	tests := []struct {
		name           string
		period, jitter time.Duration
		stalls         bool
		lostRaw        int // the unbridged record must lose at least this much, or the case proves nothing
	}{
		{"trainer 1 % slow", 1010 * time.Millisecond, 200 * time.Millisecond, false, 100},
		{"trainer 2 % slow", 1020 * time.Millisecond, 200 * time.Millisecond, false, 100},
		{"trainer 5 % slow", 1050 * time.Millisecond, 200 * time.Millisecond, false, 150},
		{"trainer 2 % fast", 980 * time.Millisecond, 300 * time.Millisecond, false, 100},
		{"stalls of one or two seconds", time.Second, 300 * time.Millisecond, true, 30},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for seed := uint64(1); seed <= 20; seed++ {
				truth, raw, bridged, out := trainerRide(tc.period, tc.jitter, tc.stalls, seconds, seed)
				if truth-raw < tc.lostRaw {
					t.Fatalf("seed %d: the raw record lost only %d s; the case no longer reproduces the loss", seed, truth-raw)
				}
				// What is left is the unfilled head and tail of the ride.
				if short := truth - bridged; short > 3 {
					t.Fatalf("seed %d: bridged record is %d s short of %d (raw was %d s short)", seed, short, truth, truth-raw)
				}
				if bridged > truth {
					t.Fatalf("seed %d: bridged record is %d s, longer than the %d s ridden", seed, bridged, truth)
				}
				for i := 1; i < len(out); i++ {
					if out[i].Clock <= out[i-1].Clock {
						t.Fatalf("seed %d: clock does not advance at %d: %d after %d", seed, i, out[i].Clock, out[i-1].Clock)
					}
				}
				for _, m := range out {
					if m.Released && (m.Watts < 180 || m.Watts > 219) {
						t.Fatalf("seed %d: bridged second at %d W is outside the measured 180–219", seed, m.Watts)
					}
				}
			}
		})
	}
}

// A real dropout is not papered over: the length shows it.
func TestRideKeepsItsDropout(t *testing.T) {
	a := newAccumulator()
	for s := 0; s < 100; s++ {
		if s >= 40 && s < 50 {
			continue
		}
		a.add("r", protocol.RiderMetrics{Seq: s + 1, Watts: 200}, nil, 0, s)
	}
	if got := len(a.byRider["r"].inOrder()); got != 90 {
		t.Fatalf("len = %d, want 90: ten silent seconds are a gap", got)
	}
}
