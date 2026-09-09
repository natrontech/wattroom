package hub

import (
	"math/rand"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Two riders on the same score used to be ranked by map iteration order —
// a winner chosen by Go's map seed (#1574). Twenty builds from freshly
// seeded maps: the order never moves.
func TestPodiumTiesBreakByRiderID(t *testing.T) {
	roster := map[string]protocol.Rider{
		"b": {ID: "b", Name: "Bea", FtpWatts: 200, WeightKg: 70},
		"a": {ID: "a", Name: "Ada", FtpWatts: 200, WeightKg: 70},
	}
	rng := rand.New(rand.NewSource(1)) //nolint:gosec // a test seed
	builds := map[string]func() []protocol.SprintScore{
		"watt-golf": func() []protocol.SprintScore {
			g := newGolf(gat(0), rng)
			g.joined = map[string]bool{"b": true, "a": true}
			g.strokes = map[string]float64{"b": 12, "a": 12}
			g.buildPodium(roster)
			return g.podium
		},
		"points-race": func() []protocol.SprintScore {
			p := newPointsRace(gat(0), rng)
			p.joined = map[string]bool{"b": true, "a": true}
			p.points = map[string]float64{"b": 5, "a": 5}
			p.buildPodium(roster)
			return p.podium
		},
		"sprint-roulette": func() []protocol.SprintScore {
			r := newRoulette(gat(0), rng)
			r.best = map[string]protocol.SprintScore{
				"b": {RiderID: "b", Name: "Bea", Wkg: 8},
				"a": {RiderID: "a", Name: "Ada", Wkg: 8},
			}
			r.buildPodium()
			return r.podium
		},
		"floor-is-lava": func() []protocol.SprintScore {
			l := newLava(gat(0), rng)
			l.joined = map[string]bool{"b": true, "a": true}
			l.lives = map[string]int{"b": 2, "a": 2}
			return l.buildPodium(roster)
		},
	}
	for mode, build := range builds {
		t.Run(mode, func(t *testing.T) {
			for i := 0; i < 20; i++ {
				podium := build()
				if len(podium) != 2 || podium[0].RiderID != "a" || podium[1].RiderID != "b" {
					t.Fatalf("build %d: %+v", i, podium)
				}
			}
		})
	}
}

// Every mode is sampled at one second (#1580): the burst tick around a
// coach-armed sprint must not advance a game four times a second.
func TestEveryModeIsSampled(t *testing.T) {
	for _, mode := range []string{"backyard-ramp", "collective-ramp", "floor-is-lava", "watt-golf", "sprint-roulette", "points-race", "team-relay"} {
		if _, ok := newGameMode(mode, gat(0)).(*sampledGame); !ok {
			t.Errorf("%s advances at the raw tick rate", mode)
		}
	}
	// Team Relay's distance is front-seconds × watts: a minute on the front
	// at 300 W is 18 000 whichever tick rate carried it.
	for _, interval := range []time.Duration{time.Second, 250 * time.Millisecond} {
		game := newGameMode("team-relay", gat(0))
		roster := backyardRoster()
		for elapsed := interval; elapsed <= 60*time.Second; elapsed += interval {
			game.advance(gat(0).Add(elapsed), map[string]int{"a": 300}, roster)
		}
		if got := game.state(gat(61)).RoomDistance; got != 18_000 {
			t.Errorf("at %s ticks: distance %v, want 18000", interval, got)
		}
	}
}

// A session start resets the ride's roster; the game keeps its own (#1581).
func TestGameRosterSurvivesASessionStart(t *testing.T) {
	rm := newRoom("roster")
	if refusal := rm.startGame("watt-golf", gat(0)); refusal != "" {
		t.Fatal(refusal)
	}
	rm.mu.Lock()
	rm.seen["a"] = protocol.Rider{ID: "a", Name: "Ada", FtpWatts: 200, WeightKg: 70}
	first := rm.gameRosterLocked()
	rm.seen = make(map[string]protocol.Rider) // what control("start") does
	second := rm.gameRosterLocked()
	rm.mu.Unlock()
	if first["a"].Name != "Ada" || second["a"].Name != "Ada" {
		t.Fatalf("the game lost its rider: %v then %v", first, second)
	}
}

// Two refusals with two different moves for the coach (#1582).
func TestStartGameNamesItsRefusal(t *testing.T) {
	rm := newRoom("refuse")
	if got := rm.startGame("dodgeball", gat(0)); got != refuseNoSuchMode {
		t.Fatalf("unknown mode: %q", got)
	}
	if got := rm.startGame("watt-golf", gat(0)); got != "" {
		t.Fatalf("first start refused: %q", got)
	}
	if got := rm.startGame("team-relay", gat(1)); got != refuseGameRunning {
		t.Fatalf("second start: %q", got)
	}
	if !rm.endGame() {
		t.Fatal("end with a game running said nothing ran")
	}
	if rm.endGame() {
		t.Fatal("end with no game said one ran")
	}
}
