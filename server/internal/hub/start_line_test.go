package hub

import (
	"slices"
	"strings"
	"testing"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func lineTick(want func(*protocol.StartLine) bool) func(protocol.ServerMessage) bool {
	return func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.StartLine != nil && want(msg.Tick.StartLine)
	}
}

// Readiness reaches the voice channel's audience only (#3228): a pick on a
// road opens the start line, kim joins it with a trainer and a heart-rate
// strap, and everyone in the channel — lea, who has not joined, too — reads
// what kim and the coach have ready. Lea is not on the line, and ola, in
// another voice channel of the same hub, hears nothing of it. The start
// takes the line away.
func TestStartLineReadinessReachesTheChannelOnly(t *testing.T) {
	h, _, url := controlHub(t)
	h.SetRoads(fakeRoads{})
	coach := dial(t, url, "jan:owner")
	kim := dial(t, url, "kim:member")
	lea := dial(t, url, "lea:member")
	ola := dial(t, strings.TrimSuffix(url, "/velvet")+"/elsewhere", "ola:member")

	pick := pickControl("On the road")
	pick.Route = &protocol.ControlRoute{ID: homeLoop, FromM: 1200}
	sendControl(t, coach, pick)
	awaitFrame(t, kim, "the start line", lineTick(func(*protocol.StartLine) bool { return true }))
	if err := wsjson.Write(t.Context(), kim, protocol.ClientMessage{Sensors: &protocol.SensorClaim{Held: []string{"trainer", "heart-rate"}, Tab: "k1"}}); err != nil {
		t.Fatal(err)
	}
	sendControl(t, kim, protocol.Control{Action: "join"})

	ready := func(line *protocol.StartLine) bool {
		return line.Ready["kim"] == protocol.Readiness{Trainer: true, HeartRate: true}
	}
	for name, conn := range map[string]*websocket.Conn{"the coach": coach, "kim": kim, "lea": lea} {
		msg := awaitFrame(t, conn, name+" reads kim ready", lineTick(ready))
		line := msg.Tick.StartLine
		if r, on := line.Ready["jan"]; !on || r != (protocol.Readiness{}) {
			t.Errorf("%s reads the coach as %+v (on the line: %v), want on it with nothing paired", name, r, on)
		}
		if _, on := line.Ready["lea"]; on {
			t.Errorf("%s reads lea on the line; she never joined", name)
		}
	}

	// Two of ola's ticks after the channel read it: the second was built
	// after kim's readiness existed.
	for range 2 {
		msg := awaitFrame(t, ola, "a tick in the other channel", func(msg protocol.ServerMessage) bool { return msg.Tick != nil })
		if msg.Tick.StartLine != nil || msg.Tick.World != nil {
			t.Fatalf("another channel's tick carries the start line %+v / %+v", msg.Tick.StartLine, msg.Tick.World)
		}
	}

	sendControl(t, coach, protocol.Control{Action: "start"})
	msg := awaitFrame(t, lea, "the count-in", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.Phase == "countdown"
	})
	if msg.Tick.StartLine != nil {
		t.Fatalf("the count-in still carries the start line %+v", msg.Tick.StartLine)
	}
}

// The world idles at the road's first metre on the start line (#3228): the
// bunch stands still where the session starts, with everyone who joined in
// it in the order they joined, and a rider who leaves the line leaves it.
// A pick with no road has no start line at all.
func TestTheStartLineStandsAtTheFirstMetre(t *testing.T) {
	h, clock, url := controlHub(t)
	h.SetRoads(fakeRoads{})
	coach := dial(t, url, "jan:owner")
	kim := dial(t, url, "kim:member")

	pick := pickControl("On the road")
	pick.Route = &protocol.ControlRoute{ID: homeLoop, FromM: 1200}
	sendControl(t, coach, pick)
	awaitFrame(t, kim, "the start line", lineTick(func(*protocol.StartLine) bool { return true }))
	sendControl(t, kim, protocol.Control{Action: "join"})
	msg := awaitFrame(t, coach, "kim on the line", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.World != nil && len(msg.Tick.World.Order) == 2
	})
	w := msg.Tick.World
	if w.BunchM != 1200 || w.SpeedMps != 0 || !slices.Equal(w.Order, []string{"jan", "kim"}) {
		t.Fatalf("the line is %+v, want jan then kim standing at 1200 m", w)
	}

	clock.Add(int64(controlMinGap))
	sendControl(t, kim, protocol.Control{Action: "leave"})
	awaitFrame(t, coach, "kim off the line", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.World != nil && slices.Equal(msg.Tick.World.Order, []string{"jan"})
	})

	clock.Add(int64(controlMinGap))
	sendControl(t, coach, pickControl("Off the road"))
	msg = awaitFrame(t, coach, "the plain pick", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.WorkoutName == "Off the road"
	})
	if msg.Tick.StartLine != nil || msg.Tick.World != nil {
		t.Fatalf("a pick with no road stands on a line: %+v / %+v", msg.Tick.StartLine, msg.Tick.World)
	}
}
