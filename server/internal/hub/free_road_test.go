package hub

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Two keys a client could send: roadHash's hex of two different roads.
var (
	roadA = strings.Repeat("a1", 32)
	roadB = strings.Repeat("b2", 32)
)

// freeRoadTick ticks a channel where each rider declared `roads[id]` and,
// when `m` names them, sent one sample at that metre; one of them, when
// `inSession` names them, rides the session instead.
func freeRoadTick(t *testing.T, roads map[string]string, m map[string]float64, inSession string) protocol.ServerTick {
	t.Helper()
	rm := newChannelState("evening")
	if inSession != "" {
		rm.session = &session{id: "s1", phase: "running", joined: map[string]struct{}{inSession: {}}}
	}
	for id, key := range roads {
		c := &client{rider: protocol.Rider{ID: id, Name: id}, out: make(chan []byte, clientQueue)}
		rm.join(c)
		rm.setFreeRoad(c, key)
		if at, sent := m[id]; sent {
			rm.setMetrics(c, protocol.RiderMetrics{Watts: 180, Seq: 1, M: at, Alt: 640})
		}
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.tickLocked(time.Now, time.Second, false).tick
}

func TestFreeRidersOnOneRoadSeeEachOther(t *testing.T) {
	for _, tc := range []struct {
		name      string
		roads     map[string]string
		m         map[string]float64
		inSession string
		want      map[string]float64 // who is placed, and where
	}{
		{
			name:  "two riders on one road",
			roads: map[string]string{"ana": roadA, "cat": roadA},
			m:     map[string]float64{"ana": 1200.04, "cat": 980},
			want:  map[string]float64{"ana": 1200, "cat": 980},
		},
		{
			name:  "a rider alone on a road sends nothing",
			roads: map[string]string{"ana": roadA, "cat": roadA, "dev": roadB},
			m:     map[string]float64{"ana": 10, "cat": 20, "dev": 30},
			want:  map[string]float64{"ana": 10, "cat": 20},
		},
		{
			name:  "riders on different roads see nobody",
			roads: map[string]string{"ana": roadA, "dev": roadB},
			m:     map[string]float64{"ana": 10, "dev": 30},
		},
		{
			name:  "a road declared and not yet ridden places nobody",
			roads: map[string]string{"ana": roadA, "cat": roadA},
			m:     map[string]float64{"ana": 10},
		},
		{
			name:  "the start of the road is a place",
			roads: map[string]string{"ana": roadA, "cat": roadA},
			m:     map[string]float64{"ana": 0, "cat": 0},
			want:  map[string]float64{"ana": 0, "cat": 0},
		},
		{
			name:      "a rider in the session rides its bunch, not their road",
			roads:     map[string]string{"ana": roadA, "cat": roadA},
			m:         map[string]float64{"ana": 10, "cat": 20},
			inSession: "cat",
		},
		{
			name:  "a key that is not one is dropped",
			roads: map[string]string{"ana": roadA, "cat": strings.ToUpper(roadA)},
			m:     map[string]float64{"ana": 10, "cat": 20},
		},
		{
			name:  "off the road again",
			roads: map[string]string{"ana": roadA, "cat": ""},
			m:     map[string]float64{"ana": 10, "cat": 20},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tick := freeRoadTick(t, tc.roads, tc.m, tc.inSession)
			if len(tick.FreeRoads) != len(tc.want) {
				t.Fatalf("free roads %v, want %v", tick.FreeRoads, tc.want)
			}
			road := 0
			for id, m := range tc.want {
				got, placed := tick.FreeRoads[id]
				if !placed || got.M != m {
					t.Errorf("%s placed %v at %v, want %v", id, placed, got.M, m)
				}
				if road == 0 {
					road = got.Road
				} else if got.Road != road {
					t.Errorf("%s on road %d, the others on %d", id, got.Road, road)
				}
			}
			// The channel's metrics still carry no place on any road (#3052).
			for id, live := range tick.Riders {
				if live.M != 0 || live.Alt != 0 {
					t.Errorf("%s's live metrics carry m %v, alt %v", id, live.M, live.Alt)
				}
			}
		})
	}
}

func TestTwoSharedRoadsAreNumberedApart(t *testing.T) {
	tick := freeRoadTick(t,
		map[string]string{"ana": roadA, "cat": roadA, "dev": roadB, "eve": roadB},
		map[string]float64{"ana": 1, "cat": 2, "dev": 3, "eve": 4}, "")
	a, b := tick.FreeRoads["ana"].Road, tick.FreeRoads["dev"].Road
	if a == 0 || b == 0 || a == b || tick.FreeRoads["cat"].Road != a || tick.FreeRoads["eve"].Road != b {
		t.Fatalf("roads %v: want ana and cat on one, dev and eve on another", tick.FreeRoads)
	}
}

func TestOnlyARoadsRidersAreSentWhereItsRidersAre(t *testing.T) {
	tick := freeRoadTick(t,
		map[string]string{"ana": roadA, "cat": roadA, "dev": roadB, "eve": roadB, "fay": ""},
		map[string]float64{"ana": 1, "cat": 2, "dev": 3, "eve": 4, "fay": 5}, "")
	frames := tickFrames{tick: &tick}
	sent := func(rider string) map[string]protocol.FreeRoadPlace {
		t.Helper()
		var msg protocol.ServerMessage
		if err := json.Unmarshal(frames.frame(frameKind{road: tick.FreeRoads[rider].Road}), &msg); err != nil {
			t.Fatal(err)
		}
		return msg.Tick.FreeRoads
	}
	if got := sent("ana"); len(got) != 2 || got["cat"].M != 2 || got["dev"].Road != 0 {
		t.Errorf("ana is sent %v, want ana and cat alone", got)
	}
	if got := sent("eve"); len(got) != 2 || got["dev"].M != 3 {
		t.Errorf("eve is sent %v, want dev and eve alone", got)
	}
	if got := sent("fay"); got != nil {
		t.Errorf("a rider on no shared road is sent %v", got)
	}
}

func TestAScreenTheTrainerLeftNoLongerPlacesItsRider(t *testing.T) {
	rm := newChannelState("evening")
	desk := &client{rider: protocol.Rider{ID: "ana"}, out: make(chan []byte, clientQueue)}
	cat := &client{rider: protocol.Rider{ID: "cat"}, out: make(chan []byte, clientQueue)}
	for _, c := range []*client{desk, cat} {
		rm.join(c)
		rm.setFreeRoad(c, roadA)
		rm.setMetrics(c, protocol.RiderMetrics{Watts: 180, Seq: 1, M: 50})
	}
	// Ana's phone takes the trainer: the desk keeps its last metre, unsaid.
	phone := &client{rider: protocol.Rider{ID: "ana"}, out: make(chan []byte, clientQueue)}
	rm.join(phone)
	rm.claimSensors(phone, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "phone"})
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if got := rm.freeRoadsLocked(); got != nil {
		t.Fatalf("free roads %v: the desk the trainer left still places ana", got)
	}
}
