package hub

import (
	"errors"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// roadWorkout's route, and one it was not built on.
const (
	homeLoop  = "3f0c2a4e-8b1d-4c5e-9f6a-7b8c9d0e1f2a"
	otherRoad = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a"
)

func routeTick(msg protocol.ServerMessage) bool {
	return msg.Tick != nil && msg.Tick.State.Route != nil
}

// A pick on a road puts the road on every tick (#3095): the crew's cut by
// hash under its generated name, where on it the bunch starts, and which
// way. The next pick replaces it, and one without a road rides none.
func TestAPickOnARoadRidesTheTick(t *testing.T) {
	h, clock, url := controlHub(t)
	h.SetRoads(fakeRoads{})
	coach := dial(t, url, "jan:owner")
	pick := pickControl("On the road")
	pick.Route = &protocol.ControlRoute{ID: homeLoop, FromM: 1200, Reverse: true, Loop: true}
	sendControl(t, coach, pick)
	tick := awaitFrame(t, coach, "the road on the tick", routeTick)
	want := protocol.SessionRoute{ID: homeLoop, Hash: "h-home", GenName: "Road · 3.0 km · 50 m", FromM: 1200, Reverse: true, LengthM: 2200, Loop: true}
	if got := *tick.Tick.State.Route; got != want {
		t.Fatalf("the tick carries %+v, want %+v", got, want)
	}

	clock.Add(int64(controlMinGap))
	sendControl(t, coach, pickControl("Off the road"))
	tick = awaitFrame(t, coach, "the plain pick on the tick", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.WorkoutName == "Off the road"
	})
	if tick.Tick.State.Route != nil {
		t.Fatalf("a pick with no road still rides %+v", tick.Tick.State.Route)
	}
}

// A road the session may not ride answers the coach in errors.md's codes and
// picks nothing: a malformed ask is validation, someone else's route reads as
// absent, and Strava's rides with its owner alone (ADR-0063).
func TestAPickOnARoadIsRefused(t *testing.T) {
	for _, c := range []struct {
		name    string
		roads   Roads
		route   protocol.ControlRoute
		workout string
		code    string
		says    string
	}{
		{"no route named", fakeRoads{}, protocol.ControlRoute{ID: "home loop"}, "", "validation_error", "names no route"},
		{"before the road", fakeRoads{}, protocol.ControlRoute{ID: homeLoop, FromM: -1}, "", "validation_error", "not before it"},
		{"past its end", fakeRoads{}, protocol.ControlRoute{ID: homeLoop, FromM: 2200}, "", "validation_error", "before 2.2 km"},
		{"a workout built on another road", fakeRoads{}, protocol.ControlRoute{ID: otherRoad}, roadWorkout, "validation_error", "another road"},
		{"not the coach's", fakeRoads{refused: &protocol.Error{Code: "not_found", Message: "That route is not one of yours."}}, protocol.ControlRoute{ID: homeLoop}, "", "not_found", "not one of yours"},
		{"from Strava", fakeRoads{refused: &protocol.Error{Code: "forbidden", Message: "Routes from Strava ride with you alone, never in a session."}}, protocol.ControlRoute{ID: homeLoop}, "", "forbidden", "Strava"},
		{"unreadable", fakeRoads{err: errors.New("connection refused")}, protocol.ControlRoute{ID: homeLoop}, "", "internal_error", "could not be read"},
		{"no roads on this server", nil, protocol.ControlRoute{ID: homeLoop}, "", "forbidden", "does not ride roads"},
	} {
		t.Run(c.name, func(t *testing.T) {
			h, _, url := controlHub(t)
			h.SetRoads(c.roads)
			coach := dial(t, url, "jan:owner")
			pick := pickControl("On the road")
			if c.workout != "" {
				pick.WorkoutJSON = c.workout
			}
			pick.Route = &c.route
			sendControl(t, coach, pick)
			refused := awaitFrame(t, coach, "the pick refused", func(msg protocol.ServerMessage) bool {
				if routeTick(msg) {
					t.Fatalf("a refused road rides the tick: %+v", msg.Tick.State.Route)
				}
				return msg.Error != nil
			})
			if refused.Error.Code != c.code || !strings.Contains(refused.Error.Message, c.says) {
				t.Fatalf("answered %+v, want %s saying %q", refused.Error, c.code, c.says)
			}
		})
	}
}

// Only the coach picks the road: a rider in the channel who is not coaching
// the open session is refused by the role, before any route is read — a read
// here would answer internal_error.
func TestOnlyTheCoachPicksTheRoad(t *testing.T) {
	h, _, url := controlHub(t)
	h.SetRoads(fakeRoads{err: errors.New("read a route for a rider who may not pick")})
	coach := dial(t, url, "jan:owner")
	sendControl(t, coach, pickControl("Openers"))
	awaitFrame(t, coach, "the coach's pick", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.WorkoutName == "Openers"
	})
	rider := dial(t, url, "kim:member")
	pick := pickControl("On the road")
	pick.Route = &protocol.ControlRoute{ID: homeLoop}
	sendControl(t, rider, pick)
	refused := awaitFrame(t, rider, "the rider's pick refused", func(msg protocol.ServerMessage) bool {
		return msg.Error != nil
	})
	if refused.Error.Code != "conflict" {
		t.Fatalf("answered %+v, want the open session's conflict", refused.Error)
	}
}

// A game that opens the session opens it on the road; one inside a session
// already running rides that session's road and may not bring its own.
func TestAGameRidesTheSessionsRoad(t *testing.T) {
	road := &protocol.ControlRoute{ID: homeLoop, FromM: 400}
	t.Run("opening the session", func(t *testing.T) {
		h, _, url := controlHub(t)
		h.SetRoads(fakeRoads{})
		coach := dial(t, url, "jan:owner")
		sendControl(t, coach, protocol.Control{Action: "game", GameMode: "floor-is-lava", Route: road})
		tick := awaitFrame(t, coach, "the game on the road", routeTick)
		if got := tick.Tick.State.Route; got.ID != homeLoop || got.FromM != 400 {
			t.Fatalf("the game rides %+v, want the home loop from 400 m", got)
		}
	})
	t.Run("inside a running session", func(t *testing.T) {
		h, _, url := controlHub(t)
		h.SetRoads(fakeRoads{})
		coach := dial(t, url, "jan:owner")
		sendControl(t, coach, pickControl("Openers"))
		sendControl(t, coach, protocol.Control{Action: "start"})
		awaitFrame(t, coach, "the countdown", func(msg protocol.ServerMessage) bool {
			return msg.Tick != nil && msg.Tick.State.Phase == "countdown"
		})
		sendControl(t, coach, protocol.Control{Action: "game", GameMode: "floor-is-lava", Route: road})
		refused := awaitFrame(t, coach, "the game refused", func(msg protocol.ServerMessage) bool {
			return msg.Error != nil
		})
		if refused.Error.Code != "invalid_request" || !strings.Contains(refused.Error.Message, "session's road") {
			t.Fatalf("answered %+v, want invalid_request about the session's road", refused.Error)
		}
	})
}

// A road workout picked onto its own road rides it, however the coach's
// client spells the id, and the tick names the route one way.
func TestARoadWorkoutRidesItsOwnRoad(t *testing.T) {
	h, _, url := controlHub(t)
	h.SetRoads(fakeRoads{})
	coach := dial(t, url, "jan:owner")
	pick := roadPick()
	pick.Route = &protocol.ControlRoute{ID: "{" + strings.ToUpper(homeLoop) + "}"}
	sendControl(t, coach, pick)
	tick := awaitFrame(t, coach, "the road workout on its road", routeTick)
	if got := tick.Tick.State.Route.ID; got != homeLoop {
		t.Fatalf("the tick names the route %q, want %q", got, homeLoop)
	}
}
