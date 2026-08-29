package hub

import (
	"math/rand"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Sprint Roulette (docs/SPEC.md): 10–15 s sprints at random 3–8 min gaps,
// klaxon 3 s before, scored on best 5 s w/kg across the game.
// ponytail: five sprints then the podium — the count is not specced, tune in alpha.
const rouletteSprints = 5

type roulette struct {
	rng      *rand.Rand
	sprintNo int
	window   *sprint
	nextAt   time.Time
	best     map[string]protocol.SprintScore
	joined   map[string]bool
	finished bool
	podium   []protocol.SprintScore
}

func newRoulette(now time.Time, rng *rand.Rand) *roulette {
	r := &roulette{
		rng:    rng,
		best:   make(map[string]protocol.SprintScore),
		joined: make(map[string]bool),
	}
	r.schedule(now, true)
	return r
}

// schedule draws the next gap — short for the first so the game starts moving.
func (r *roulette) schedule(now time.Time, first bool) {
	gap := time.Duration(180+r.rng.Intn(300)) * time.Second
	if first {
		gap = time.Duration(20+r.rng.Intn(40)) * time.Second
	}
	r.nextAt = now.Add(gap)
	r.window = nil
}

func (r *roulette) advance(now time.Time, samples map[string]int, roster map[string]protocol.Rider) {
	if r.finished {
		return
	}
	for id := range samples {
		r.joined[id] = true
	}

	if r.window == nil && now.After(r.nextAt) {
		r.sprintNo++
		length := time.Duration(10+r.rng.Intn(6)) * time.Second
		r.window = &sprint{
			startsAt: now.Add(sprintKlaxon),
			endsAt:   now.Add(sprintKlaxon + length),
			samples:  make(map[string][]int),
		}
	}
	if r.window == nil {
		return
	}
	for id, watts := range samples {
		r.window.collect(id, watts, now)
	}
	if now.After(r.window.endsAt) {
		for _, score := range podium(r.window.samples, roster) {
			if best, ok := r.best[score.RiderID]; !ok || score.Wkg > best.Wkg {
				r.best[score.RiderID] = score
			}
		}
		if r.sprintNo >= rouletteSprints {
			r.finished = true
			r.buildPodium()
			return
		}
		r.schedule(now, false)
	}
}

func (r *roulette) buildPodium() {
	for _, score := range r.best {
		r.podium = append(r.podium, score)
	}
	sort.Slice(r.podium, func(i, j int) bool { return r.podium[i].Wkg > r.podium[j].Wkg })
}

func (r *roulette) state(now time.Time) protocol.GameState {
	phase := "running"
	if r.finished {
		phase = "done"
	}
	riders := make(map[string]protocol.GameRider, len(r.joined))
	for id := range r.joined {
		riders[id] = protocol.GameRider{Score: r.best[id].Wkg}
	}
	out := protocol.GameState{
		Mode: "sprint-roulette", Phase: phase, Round: r.sprintNo,
		Riders: riders, Podium: r.podium,
	}
	// The klaxon and window ride the existing sprint anchors on the tick via
	// RoundEndsAtMs; the surprise is the point, so nextAt is never exposed.
	if r.window != nil {
		out.RoundEndsAtMs = r.window.endsAt.UnixMilli()
	}
	return out
}

func (r *roulette) done() bool { return r.finished }
