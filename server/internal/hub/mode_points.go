package hub

import (
	"math/rand"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Points Race (docs/SPEC.md): sprints score 5/3/2/1; best interval-execution
// takes 3 pts; a time-in-zone streak earns 1 pt per interval held. Intervals
// here are fixed 2-minute blocks; sprints arrive roulette-style.
const (
	pointsIntervalLen = 2 * time.Minute
	pointsSprints     = 4
)

var sprintPoints = []float64{5, 3, 2, 1}

type pointsRace struct {
	rng         *rand.Rand
	roulette    *roulette
	interval    int
	intervalEnd time.Time
	// Zone held per rider this interval; -1 = broken.
	heldZone map[string]int
	points   map[string]float64
	joined   map[string]bool
	finished bool
	podium   []protocol.SprintScore
}

func newPointsRace(now time.Time, rng *rand.Rand) *pointsRace {
	p := &pointsRace{
		rng:         rng,
		roulette:    newRoulette(now, rng),
		interval:    1,
		intervalEnd: now.Add(pointsIntervalLen),
		heldZone:    make(map[string]int),
		points:      make(map[string]float64),
		joined:      make(map[string]bool),
	}
	p.roulette.sprintNo = rouletteSprints - pointsSprints // budget 4 sprints
	return p
}

func (p *pointsRace) advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider) {
	if p.finished {
		return
	}
	for id := range samples {
		p.joined[id] = true
	}

	// Sprints ride the embedded roulette; each closed window pays 5/3/2/1.
	before := p.roulette.window
	p.roulette.advance(now, samples, roster)
	if before != nil && p.roulette.window != before {
		// A window just closed and rescheduled (or the game ended): award it.
		for place, score := range podium(before.samples, roster) {
			if place < len(sprintPoints) {
				p.points[score.RiderID] += sprintPoints[place]
			}
		}
	}

	// Time-in-zone streak: hold one zone for a whole interval, take a point.
	for id, watts := range samples {
		rider, ok := roster[id]
		if !ok || rider.FtpWatts <= 0 {
			continue
		}
		zone := zoneOfPct(float64(watts) / float64(rider.FtpWatts))
		if held, seen := p.heldZone[id]; !seen {
			p.heldZone[id] = zone
		} else if held != -1 && held != zone {
			p.heldZone[id] = -1
		}
	}
	if now.After(p.intervalEnd) {
		for id, held := range p.heldZone {
			if held > 0 {
				p.points[id]++
			}
		}
		p.heldZone = make(map[string]int)
		p.interval++
		p.intervalEnd = now.Add(pointsIntervalLen)
	}

	if p.roulette.done() {
		// Final award: best execution is not visible here (it lives with the
		// workout pipeline), so the last sprint podium's leader takes the 3 pts
		// as the race-craft bonus. ponytail: swap to interval-execution when a
		// points race runs inside a workout session.
		if len(p.roulette.podium) > 0 {
			p.points[p.roulette.podium[0].RiderID] += 3
		}
		p.finished = true
		p.buildPodium(roster)
	}
}

func zoneOfPct(pct float64) int {
	for zone := 1; zone <= 7; zone++ {
		if pct >= zoneBounds[zone][0] && pct < zoneBounds[zone][1] {
			return zone
		}
	}
	return 7
}

func (p *pointsRace) buildPodium(roster map[string]protocol.Rider) {
	ids := make([]string, 0, len(p.joined))
	for id := range p.joined {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return p.points[ids[i]] > p.points[ids[j]] })
	for _, id := range ids {
		p.podium = append(p.podium, protocol.SprintScore{
			RiderID: id, Name: roster[id].Name, Wkg: p.points[id],
		})
	}
}

func (p *pointsRace) state(now time.Time) protocol.GameState {
	phase := "running"
	if p.finished {
		phase = "done"
	}
	riders := make(map[string]protocol.GameRider, len(p.joined))
	for id := range p.joined {
		riders[id] = protocol.GameRider{Score: p.points[id]}
	}
	out := protocol.GameState{
		Mode: "points-race", Phase: phase, Round: p.interval,
		RoundEndsAtMs: p.intervalEnd.UnixMilli(), Riders: riders, Podium: p.podium,
	}
	return out
}

func (p *pointsRace) done() bool { return p.finished }
