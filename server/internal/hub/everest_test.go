package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// One rider's samples, each the free ride's running total `climbed` metres,
// `after` seconds after the one before it.
type climbSample struct {
	after   int
	climbed float64
}

func TestEverestTogetherCountsWhatEachRiderClimbsOnTheSession(t *testing.T) {
	for _, tc := range []struct {
		name    string
		samples map[string][]climbSample
		want    int
	}{
		{
			name:    "a rider's climb before they joined is their own",
			samples: map[string][]climbSample{"ana": {{0, 700}, {1, 702}, {1, 704.5}}},
			want:    4,
		},
		{
			name: "riders add up",
			samples: map[string][]climbSample{
				"ana": {{0, 0}, {1, 3}, {1, 6}},
				"ben": {{0, 100}, {1, 104}},
			},
			want: 10,
		},
		{
			name:    "a total that falls is a new free ride, counted from nought",
			samples: map[string][]climbSample{"ana": {{0, 0}, {1, 5}, {1, 2}, {1, 4}}},
			want:    9,
		},
		{
			name:    "a rise past 6 m a second counts 6 m a second",
			samples: map[string][]climbSample{"ana": {{0, 0}, {1, 50}, {1, 52}}},
			want:    8,
		},
		{
			name:    "a silence lets the climb ridden through it count",
			samples: map[string][]climbSample{"ana": {{0, 0}, {10, 40}}},
			want:    40,
		},
		{
			name:    "a descent counts nothing",
			samples: map[string][]climbSample{"ana": {{0, 200}, {1, 200}, {60, 200}}},
			want:    0,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := make(everest)
			for rider, samples := range tc.samples {
				at := time.Unix(1_800_000_000, 0)
				for _, s := range samples {
					at = at.Add(time.Duration(s.after) * time.Second)
					e.hear(rider, s.climbed, at)
				}
			}
			if got := e.sum(); got != tc.want {
				t.Fatalf("sum = %d, want %d", got, tc.want)
			}
		})
	}
}

// Three riders on climb repeats (#3193): each climbs a 200 m hill at 1 m a
// second and rides it back down for 100 s, which climbs nothing, until the
// crew's sum passes Everest. Their own counts go on from where their free
// rides started, at 120, 0 and 640 m.
func TestEverestTogetherReachesEverestOnAFixture(t *testing.T) {
	e := make(everest)
	riders := map[string]float64{"ana": 120, "ben": 0, "cat": 640}
	at := time.Unix(1_800_000_000, 0)
	for id, total := range riders {
		e.hear(id, total, at)
	}
	seconds := 0
	for e.sum() < protocol.EverestM {
		if seconds > 100_000 {
			t.Fatal("never reached Everest")
		}
		seconds++
		at = at.Add(time.Second)
		up := (seconds-1)%300 < 200
		for id, total := range riders {
			if up {
				total++
			}
			riders[id] = total
			e.hear(id, total, at)
		}
	}
	// 8,849 m among three is 2,950 m each: 14 repeats and 150 m up the 15th,
	// 14 × 300 + 150 s.
	if seconds != 14*300+150 || e.sum() != 8850 {
		t.Fatalf("Everest after %d s at %d m, want 4,350 s and 8,850 m", seconds, e.sum())
	}
}

// Through the room: the sum rides the tick of a Ride together session and no
// other, counts only riders who joined it, and no rider's climb is on the
// tick.
func TestEverestTogetherRidesTheTick(t *testing.T) {
	for _, tc := range []struct {
		name     string
		together bool
		want     int
	}{
		{name: "riding together", together: true, want: 30},
		{name: "a workout session", together: false, want: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			clock := time.Unix(1_800_000_000, 0)
			rm := newChannelState("crew-session")
			rm.now = func() time.Time { return clock }
			rm.session = &session{id: "s1", phase: "running", startedAt: clock, together: tc.together,
				joined: map[string]struct{}{"ana": {}, "ben": {}}}
			clients := map[string]*client{}
			for _, id := range []string{"ana", "ben", "eve"} {
				c := &client{rider: protocol.Rider{ID: id, Name: id}, out: make(chan []byte, clientQueue)}
				rm.join(c)
				clients[id] = c
			}
			for second := range 6 {
				clock = clock.Add(time.Second)
				for _, id := range []string{"ana", "ben", "eve"} {
					// Eve spectates: her climb is hers.
					rm.setMetrics(clients[id], protocol.RiderMetrics{Watts: 200, Seq: second + 1, Climbed: float64(second * 3)})
				}
			}
			rm.mu.Lock()
			tick := rm.tickLocked(rm.now, time.Second, false).tick
			rm.mu.Unlock()
			if tick.EverestTogether != tc.want {
				t.Fatalf("EverestTogether = %d, want %d", tick.EverestTogether, tc.want)
			}
			for id, m := range tick.Riders {
				if m.Climbed != 0 {
					t.Errorf("%s's own climb is on the tick: %v", id, m.Climbed)
				}
			}
		})
	}
}

func TestAClimbNoRideCanHaveIsRefused(t *testing.T) {
	for _, tc := range []struct {
		climbed float64
		ok      bool
	}{
		{0, true},
		{protocol.MaxRideClimbedM, true},
		{-1, false},
		{protocol.MaxRideClimbedM + 1, false},
	} {
		if got := validMetrics(protocol.RiderMetrics{Climbed: tc.climbed}); got != tc.ok {
			t.Errorf("validMetrics(climbed %v) = %v, want %v", tc.climbed, got, tc.ok)
		}
	}
}
