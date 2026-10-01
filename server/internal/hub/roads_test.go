package hub

import (
	"context"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/workout"
)

const roadWorkout = `{"name":"Home loop","road":{"routeId":"3f0c2a4e-8b1d-4c5e-9f6a-7b8c9d0e1f2a","fromM":0,"toM":3000},"steps":[{"type":"road","seconds":600}]}`

// fakeRoads answers every pick the way routes.Attacher would for a crew:
// the reference with the crew's cut attached, marked so the test can see it,
// and every session road as a 2.2 km cut of the coach's home loop.
type fakeRoads struct {
	refusal string
	refused *protocol.Error
	err     error
	// The cut's heights every 20 m; nil is a flat 2.2 km.
	heights []float64
}

func (f fakeRoads) SessionRoute(_ context.Context, _, routeID string) (protocol.SessionRoute, road.Road, *protocol.Error, error) {
	if f.err != nil || f.refused != nil {
		return protocol.SessionRoute{}, road.Road{}, f.refused, f.err
	}
	heights := f.heights
	if heights == nil {
		heights = make([]float64, 2200/20+1)
	}
	profile := road.Road{LengthM: float64(20 * (len(heights) - 1)), Heights: heights}
	return protocol.SessionRoute{ID: routeID, Hash: "h-home", GenName: "Road · 3.0 km · 50 m", LengthM: profile.LengthM}, profile, nil, nil
}

func (f fakeRoads) ForSession(_ context.Context, coach, workoutJSON string) (string, string, error) {
	if f.refusal != "" {
		return "", f.refusal, nil
	}
	return strings.Replace(workoutJSON, `"toM":3000}`, `"toM":3000,"profile":"the crew's cut"}`, 1), "", nil
}

// SharedName names a road workout by its route's generated name, the way
// routes.SharedName does.
func (f fakeRoads) SharedName(_ context.Context, workoutJSON, name string) (string, error) {
	if ref, _ := workout.RoadOf(workoutJSON); ref != nil {
		return "Road · 3.0 km · 50 m", nil
	}
	return name, nil
}

func roadPick() protocol.Control {
	return protocol.Control{Action: "pick", WorkoutName: "Home loop", WorkoutJSON: roadWorkout, TotalSeconds: 600}
}

// A picked road reaches the channel as the crew's cut (#3051): the tick
// carries what Roads attached, never the coach's bare reference.
func TestAPickedRoadRidesTheTickAsTheCrewsCut(t *testing.T) {
	h, _, url := controlHub(t)
	h.SetRoads(fakeRoads{})
	coach := dial(t, url, "jan:owner")
	sendControl(t, coach, roadPick())
	tick := awaitFrame(t, coach, "the road's pick on the tick", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.WorkoutJSON != ""
	})
	if !strings.Contains(tick.Tick.State.WorkoutJSON, `"profile":"the crew's cut"`) {
		t.Fatalf("the tick carries %s, want the crew's cut attached", tick.Tick.State.WorkoutJSON)
	}
}

// A road the coach may not share, or a server with no roads, answers the
// coach and starts nothing.
func TestAPickedRoadIsRefusedWhenItMayNotRide(t *testing.T) {
	for _, c := range []struct {
		name  string
		roads Roads
		says  string
	}{
		{"not the coach's route", fakeRoads{refusal: "That route is not yours to ride with others."}, "not yours"},
		{"no roads on this server", nil, "does not ride roads"},
	} {
		t.Run(c.name, func(t *testing.T) {
			h, _, url := controlHub(t)
			h.SetRoads(c.roads)
			coach := dial(t, url, "jan:owner")
			sendControl(t, coach, roadPick())
			refused := awaitFrame(t, coach, "the pick refused", func(msg protocol.ServerMessage) bool {
				return msg.Error != nil
			})
			if refused.Error.Code != "forbidden" || !strings.Contains(refused.Error.Message, c.says) {
				t.Fatalf("answered %+v, want forbidden saying %q", refused.Error, c.says)
			}
		})
	}
}

// A road workout goes out under its route's generated name (#3055): the
// coach named the route after where they live, and that name reaches no
// tick, no presence radar and no live-session card — nor the recap and the
// saved rides, which read the same state.
func TestAPickedRoadGoesOutUnderItsGeneratedName(t *testing.T) {
	h, _, url := controlHub(t)
	h.SetRoads(fakeRoads{})
	coach := dial(t, url, "jan:owner")
	pick := roadPick()
	pick.WorkoutName = "From home to the Gurnigel"
	sendControl(t, coach, pick)
	sendControl(t, coach, protocol.Control{Action: "start"})
	tick := awaitFrame(t, coach, "the road's session counting down", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.Phase == "countdown"
	})
	const generated = "Road · 3.0 km · 50 m"
	live, _ := h.LiveSession("velvet")
	for surface, name := range map[string]string{
		"the tick":         tick.Tick.State.WorkoutName,
		"the radar":        h.Presence("velvet").WorkoutName,
		"the live session": live.Workout,
	} {
		if name != generated {
			t.Errorf("%s names the session %q, want %q", surface, name, generated)
		}
	}
}
