package hub

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// onTheRoad is a running session on a road, the coach riding it and ben at
// the roadside, the bunch a minute along it.
func onTheRoad(t *testing.T, route *routeRide) (*channelState, map[string]*client, time.Time) {
	t.Helper()
	coach, ben := as("coach"), as("ben")
	rm, clients := inChannel(t, "velvet", coach, ben)
	now := time.Unix(1_700_000_000, 0)
	for _, a := range []string{"pick", "start"} {
		r := route
		if a != "pick" {
			r = nil
		}
		if code, message := rm.controlOn(protocol.Control{Action: a, WorkoutName: "Out", WorkoutJSON: ergHalfHour}, r, coach, now); code != "" {
			t.Fatalf("%s: %s", a, message)
		}
	}
	return rm, clients, tickFor(rm, now.Add(countdownSeconds*time.Second), 60)
}

// tickFor runs the room's own tick through whole seconds.
func tickFor(rm *channelState, now time.Time, seconds int) time.Time {
	for range seconds {
		now = now.Add(time.Second)
		rm.mu.Lock()
		rm.tickLocked(func() time.Time { return now }, time.Second, false)
		rm.mu.Unlock()
	}
	return now
}

func bunchAt(rm *channelState) float64 {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.session.bunch.fromM + rm.session.bunch.pace.Distance
}

func standing(rm *channelState) *protocol.RoadsideState {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.session.roadside()
}

// #3029's acceptance: the validation matrix, with docs/SPEC.md's bounds.
func TestTheRoadsideTakesAStandWithinItsBounds(t *testing.T) {
	stand := func(atM float64) protocol.Roadside {
		return protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: atM}
	}
	for _, c := range []struct {
		name  string
		rider string
		verb  func(bunch float64) protocol.Roadside
		code  string
		says  string
	}{
		{"a kilometre up the road", "ben", func(b float64) protocol.Roadside { return stand(b + 1000) }, "", ""},
		{"just far enough", "ben", func(b float64) protocol.Roadside { return stand(b + 300) }, "", ""},
		{"as far as it goes", "ben", func(b float64) protocol.Roadside { return stand(b + 5000) }, "", ""},
		{"too close", "ben", func(b float64) protocol.Roadside { return stand(b + 299) }, "validation_error", "300 m – 5 km ahead"},
		{"too far", "ben", func(b float64) protocol.Roadside { return stand(b + 5001) }, "validation_error", "300 m – 5 km ahead"},
		{"behind the bunch", "ben", func(b float64) protocol.Roadside { return stand(b - 100) }, "validation_error", "ahead of the bunch"},
		{"off the road's end", "ben", func(float64) protocol.Roadside { return stand(20_001) }, "validation_error", "not a place on this road"},
		{"a lap on a road that does not loop", "ben", func(b float64) protocol.Roadside {
			return protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: b + 1000, Lap: 1}
		}, "validation_error", "not a place on this road"},
		{"not a place at all", "ben", func(float64) protocol.Roadside { return stand(math.NaN()) }, "validation_error", "not a place"},
		{"a verb the roadside has not got", "ben", func(b float64) protocol.Roadside {
			return protocol.Roadside{Kind: "paint", AtM: b + 1000}
		}, "validation_error", "nothing else yet"},
		{"a rider riding the session", "coach", func(b float64) protocol.Roadside { return stand(b + 1000) }, "forbidden", "riding this session"},
	} {
		t.Run(c.name, func(t *testing.T) {
			rm, _, now := onTheRoad(t, rideOn(slope(0, 20_000), 0, false, false))
			code, message := rm.roadsideVerb(c.rider, c.verb(bunchAt(rm)), now)
			if code != c.code || !strings.Contains(message, c.says) {
				t.Fatalf("answered %q %q, want %q saying %q", code, message, c.code, c.says)
			}
			if st := standing(rm); (c.code == "") != (len(st.Stands) == 1) {
				t.Fatalf("the roadside reads %+v after a %q answer", st, code)
			}
		})
	}
}

// Without a road there is nothing to stand beside.
func TestNoRoadNoStand(t *testing.T) {
	rm, _, now := onTheRoad(t, nil)
	if code, _ := rm.roadsideVerb("ben", protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: 1000}, now); code != "invalid_request" {
		t.Fatalf("a stand with no road answered %q, want invalid_request", code)
	}
	if standing(rm) != nil {
		t.Fatal("a session with no road carries a roadside")
	}
}

// A stand moves at most once a minute, and not at all as the riders close
// on it; the bunch passing it lets it go, and the revision says so.
func TestAStandMovesOnceAMinuteAndGoesWhenPassed(t *testing.T) {
	rm, _, now := onTheRoad(t, rideOn(slope(0, 20_000), 0, false, false))
	stand := func(ahead float64) (string, string) {
		return rm.roadsideVerb("ben", protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: bunchAt(rm) + ahead}, now)
	}
	if code, message := stand(2000); code != "" {
		t.Fatal(message)
	}
	placed := standing(rm).Rev
	if code, message := stand(1500); code != "rate_limited" || !strings.Contains(message, "again in 60 s") {
		t.Fatalf("moving it at once answered %q %q, want rate_limited with the wait", code, message)
	}
	now = tickFor(rm, now, 60)
	if code, message := stand(900); code != "" {
		t.Fatalf("a minute later: %s", message)
	}
	// The riders close on it — some 600 m on, a minute and more since it
	// moved: frozen all the same.
	now = tickFor(rm, now, 70)
	if code, message := stand(2000); code != "rate_limited" || !strings.Contains(message, "nearly at your stand") {
		t.Fatalf("moving a stand the riders are on answered %q %q, want it frozen", code, message)
	}
	// And they pass it.
	tickFor(rm, now, 40)
	if st := standing(rm); len(st.Stands) != 0 || st.Rev <= placed+1 {
		t.Fatalf("after the bunch passed, the roadside reads %+v (placed at rev %d)", st, placed)
	}
}

// A loop's stand may be on the next lap, and reads back where it was put.
func TestALoopsStandIsOnItsLap(t *testing.T) {
	rm, _, now := onTheRoad(t, rideOn(slope(0, 2200), 0, true, false))
	at := bunchAt(rm) + 2000 - 2200
	if code, message := rm.roadsideVerb("ben", protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: at, Lap: 1}, now); code != "" {
		t.Fatal(message)
	}
	if st := standing(rm).Stands; len(st) != 1 || st[0].Lap != 1 || math.Abs(st[0].AtM-at) > 0.01 || st[0].RiderID != "ben" {
		t.Fatalf("the roadside reads %+v, want ben at %.2f m on lap 1", st, at)
	}
}

// A spectator who joins the session leaves the roadside, and so does one
// who leaves the channel.
func TestAStandGoesWithTheSpectator(t *testing.T) {
	rm, clients, now := onTheRoad(t, rideOn(slope(0, 20_000), 0, false, false))
	if code, message := rm.roadsideVerb("ben", protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: bunchAt(rm) + 3000}, now); code != "" {
		t.Fatal(message)
	}
	if code, message := rm.controlOn(protocol.Control{Action: "join"}, nil, as("ben"), now); code != "" {
		t.Fatal(message)
	}
	now = tickFor(rm, now, 1)
	if st := standing(rm); len(st.Stands) != 0 {
		t.Fatalf("ben rides the session and still stands at %+v", st.Stands)
	}

	rm.controlOn(protocol.Control{Action: "leave"}, nil, as("ben"), now)
	if code, message := rm.roadsideVerb("ben", protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: bunchAt(rm) + 3000}, now); code != "" {
		t.Fatal(message)
	}
	rm.leave(clients["ben"])
	tickFor(rm, now, 1)
	if st := standing(rm); len(st.Stands) != 0 {
		t.Fatalf("ben left the channel and still stands at %+v", st.Stands)
	}
}

// A refused deliberate verb answers the spectator, on their socket, with the
// roadside's own prefix (errors.md).
func TestARefusedStandAnswersTheSpectator(t *testing.T) {
	_, _, url := controlHub(t)
	ben := dial(t, url, "ben:member")
	awaitFrame(t, ben, "the first tick", func(msg protocol.ServerMessage) bool { return msg.Tick != nil })
	if err := wsjson.Write(t.Context(), ben, protocol.ClientMessage{Roadside: &protocol.Roadside{Kind: protocol.RoadsideKindStand, AtM: 1000}}); err != nil {
		t.Fatal(err)
	}
	refused := awaitFrame(t, ben, "the refusal", func(msg protocol.ServerMessage) bool { return msg.Error != nil })
	if refused.Error.Code != "roadside_invalid_request" || !strings.Contains(refused.Error.Message, "no road") {
		t.Fatalf("the spectator was answered %+v", refused.Error)
	}
}
