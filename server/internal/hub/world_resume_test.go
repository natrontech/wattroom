package hub

import (
	"math"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// #3103's acceptance: an e2e restart puts the bunch back within 25 m. A
// process that restarts forms the channel afresh (ADR-0052); the coach's
// screen still has the last tick it heard, and picks the same workout on the
// same road from that tick's metre. The tick it missed — the second before
// the process went — is all the new bunch may lose.
func TestARestartPutsTheBunchBackWithin25m(t *testing.T) {
	const erg = `{"name":"Out","steps":[{"type":"steady","seconds":3600,"target":0.75}]}`
	pick := func(fromM float64) protocol.Control {
		return protocol.Control{
			Action: "pick", WorkoutName: "Out", WorkoutJSON: erg, TotalSeconds: 3600,
			Route: &protocol.ControlRoute{ID: homeLoop, FromM: fromM},
		}
	}
	running := func(at int64) func(protocol.ServerMessage) bool {
		return func(msg protocol.ServerMessage) bool {
			return msg.Tick != nil && msg.Tick.At >= at && msg.Tick.State.Phase == "running" && msg.Tick.World != nil
		}
	}
	ride := func(clock interface{ Add(int64) int64 }, coach *websocket.Conn, from float64) {
		sendControl(t, coach, pick(from))
		awaitFrame(t, coach, "the road picked", routeTick)
		clock.Add(int64(controlMinGap))
		sendControl(t, coach, protocol.Control{Action: "start"})
		awaitFrame(t, coach, "the countdown", func(msg protocol.ServerMessage) bool {
			return msg.Tick != nil && msg.Tick.State.Phase == "countdown"
		})
		clock.Add(int64(countdownSeconds * time.Second))
	}
	road := fakeRoads{heights: slope(2, 20_000).Heights}

	before, clockBefore, urlBefore := controlHub(t)
	before.SetRoads(road)
	coach := dial(t, urlBefore, "jan:owner")
	ride(clockBefore, coach, 1200)
	// Twenty minutes on, as the coach's screen last heard it.
	clockBefore.Add(int64(20 * time.Minute))
	heard := awaitFrame(t, coach, "the last tick heard", running(time.Unix(0, clockBefore.Load()).UnixMilli())).Tick.World
	// One more second the screen never heard, and the process goes.
	clockBefore.Add(int64(time.Second))
	rm := before.stateOf("velvet")
	rm.mu.Lock()
	rm.session.rideBunch(time.Unix(0, clockBefore.Load()))
	lost := rm.session.bunch.fromM + rm.session.bunch.pace.Distance
	rm.mu.Unlock()

	after, clockAfter, urlAfter := controlHub(t)
	after.SetRoads(road)
	coach = dial(t, urlAfter, "jan:owner")
	ride(clockAfter, coach, heard.BunchM)
	back := awaitFrame(t, coach, "the bunch back on its road", running(time.Unix(0, clockAfter.Load()).UnixMilli())).Tick.World
	if heard.BunchM < 3000 || math.Abs(back.BunchM-lost) > 25 {
		t.Fatalf("the bunch was at %.1f m when the process went, the screen last heard %.1f m, and it came back at %.1f m; want within 25 m",
			lost, heard.BunchM, back.BunchM)
	}
}
