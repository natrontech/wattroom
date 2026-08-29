package hub

import (
	"math"
	"math/rand"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Watt Golf (docs/SPEC.md): 9 holes of "hit X W for 10 s, starting in 20 s".
// The meter hides from 20 s before to hole end; strokes are the mean absolute
// deviation in watts over the window; targets 60–110 % of each rider's own
// FTP, so the course is the same shape for everyone. Lowest total wins.
const (
	golfHoles     = 9
	golfLeadIn    = 20 * time.Second
	golfWindow    = 10 * time.Second
	golfBetween   = 20 * time.Second
	golfMinPct    = 0.60
	golfPctSpread = 0.50 // up to 110 %
)

type golf struct {
	rng      *rand.Rand
	hole     int
	holePct  float64
	holeAt   time.Time // window start
	strokes  map[string]float64
	window   map[string][]int
	joined   map[string]bool
	finished bool
	podium   []protocol.SprintScore
}

func newGolf(now time.Time, rng *rand.Rand) *golf {
	g := &golf{
		rng:     rng,
		strokes: make(map[string]float64),
		window:  make(map[string][]int),
		joined:  make(map[string]bool),
	}
	g.tee(now, 1)
	return g
}

func (g *golf) tee(now time.Time, hole int) {
	g.hole = hole
	// Whole percent, read out loud like the ramp line.
	g.holePct = math.Round((golfMinPct+g.rng.Float64()*golfPctSpread)*100) / 100
	g.holeAt = now.Add(golfLeadIn)
	g.window = make(map[string][]int)
}

func (g *golf) advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider) {
	if g.finished {
		return
	}
	for id := range samples {
		g.joined[id] = true
	}
	windowEnd := g.holeAt.Add(golfWindow)

	if now.After(g.holeAt) && now.Before(windowEnd) {
		for id, watts := range samples {
			if len(g.window[id]) < 32 {
				g.window[id] = append(g.window[id], watts)
			}
		}
		return
	}

	if now.After(windowEnd) {
		// Score the hole: mean absolute deviation from the rider's own target.
		for id := range g.joined {
			rider, ok := roster[id]
			if !ok || rider.FtpWatts <= 0 {
				continue
			}
			target := g.holePct * float64(rider.FtpWatts)
			hits := g.window[id]
			if len(hits) == 0 {
				// A whiffed hole costs a full target of strokes — worse than any
				// swing, better than unbounded.
				g.strokes[id] += target
				continue
			}
			var dev float64
			for _, w := range hits {
				dev += math.Abs(float64(w) - target)
			}
			g.strokes[id] += dev / float64(len(hits))
		}
		if g.hole >= golfHoles {
			g.finished = true
			g.buildPodium(roster)
			return
		}
		g.tee(now.Add(golfBetween-golfLeadIn), g.hole+1)
	}
}

func (g *golf) buildPodium(roster map[string]protocol.Rider) {
	ids := make([]string, 0, len(g.joined))
	for id := range g.joined {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return g.strokes[ids[i]] < g.strokes[ids[j]] })
	for _, id := range ids {
		g.podium = append(g.podium, protocol.SprintScore{
			RiderID: id, Name: roster[id].Name, Wkg: math.Round(g.strokes[id]),
		})
	}
}

func (g *golf) state(now time.Time) protocol.GameState {
	phase := "running"
	if g.finished {
		phase = "done"
	}
	riders := make(map[string]protocol.GameRider, len(g.joined))
	for id := range g.joined {
		riders[id] = protocol.GameRider{Score: math.Round(g.strokes[id])}
	}
	// The meter hides from the moment the hole is announced to its end (SPEC).
	hidden := now.Before(g.holeAt.Add(golfWindow))
	return protocol.GameState{
		Mode: "watt-golf", Phase: phase, Round: g.hole, LinePct: g.holePct,
		RoundEndsAtMs: g.holeAt.UnixMilli(), MeterHidden: hidden,
		Riders: riders, Podium: g.podium,
	}
}

func (g *golf) done() bool { return g.finished }
