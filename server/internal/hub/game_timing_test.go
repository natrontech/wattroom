package hub

import (
	"maps"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestEliminationTimingIgnoresSprintTickRate(t *testing.T) {
	for _, mode := range []string{"floor-is-lava", "backyard-ramp", "collective-ramp"} {
		t.Run(mode, func(t *testing.T) {
			for _, interval := range []time.Duration{time.Second, 250 * time.Millisecond} {
				t.Run(interval.String(), func(t *testing.T) {
					game := newGameMode(mode, gat(0))
					roster := backyardRoster()
					a, b := 160, 240
					if mode == "floor-is-lava" {
						low := zoneBounds[game.state(gat(0)).CalledZone][0]
						a, b = int(low*200)+5, int(low*300)+5
					}
					game.advance(gat(1), map[string]int{"a": a, "b": b}, roster)
					want := 41 * time.Second // 30 s grace, then ten judged seconds.
					if mode == "floor-is-lava" {
						want = 37 * time.Second // First life burns on the sixth judged second.
					}
					for elapsed := time.Second + interval; elapsed <= want; elapsed += interval {
						var samples map[string]int
						if elapsed%time.Second == 0 {
							samples = map[string]int{"a": a}
						}
						now := gat(0).Add(elapsed)
						game.advance(now, samples, roster)
						state := game.state(now)
						penalized := game.done()
						if mode == "floor-is-lava" {
							penalized = state.Riders["b"].Lives < lavaLives
						}
						if penalized != (elapsed == want) {
							t.Fatalf("at %s: penalized=%v, expected first penalty at %s", elapsed, penalized, want)
						}
					}
				})
			}
		})
	}
}

type recordingGame struct {
	ticks []map[string]int
}

func (g *recordingGame) advance(_ time.Time, samples map[string]int, _ map[string]protocol.Rider) {
	g.ticks = append(g.ticks, maps.Clone(samples))
}
func (*recordingGame) state(time.Time) protocol.GameState { return protocol.GameState{} }
func (*recordingGame) done() bool                         { return false }

func TestSampledGameRetainsInterleavedSamples(t *testing.T) {
	mode := &recordingGame{}
	game := newSampledGame(mode, gat(0))
	game.advance(gat(0).Add(250*time.Millisecond), map[string]int{"a": 100}, nil)
	game.advance(gat(0).Add(500*time.Millisecond), map[string]int{"b": 240}, nil)
	game.advance(gat(0).Add(750*time.Millisecond), map[string]int{"a": 160}, nil)
	if len(mode.ticks) != 0 {
		t.Fatal("judged before a full second")
	}
	game.advance(gat(1), nil, nil)
	if len(mode.ticks) != 1 || !maps.Equal(mode.ticks[0], map[string]int{"a": 160, "b": 240}) {
		t.Fatalf("lost or stale interleaved samples: %v", mode.ticks)
	}
	game.advance(gat(2), nil, nil)
	if len(mode.ticks) != 2 || len(mode.ticks[1]) != 0 {
		t.Fatalf("reused an old sample: %v", mode.ticks)
	}
	game.advance(gat(10), nil, nil)
	game.advance(gat(10).Add(250*time.Millisecond), nil, nil)
	if len(mode.ticks) != 3 {
		t.Fatalf("replayed missed seconds after a delayed tick: %v", mode.ticks)
	}
}
