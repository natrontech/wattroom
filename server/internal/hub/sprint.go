package hub

import (
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Sprint moment timing (docs/SPEC.md): klaxon 3 s before, 15 s all-out window,
// podium held long enough to be seen. The tick bursts to 4 Hz while live.
const (
	sprintKlaxon = 3 * time.Second
	sprintWindow = 15 * time.Second
	sprintLinger = 30 * time.Second
	burstTick    = 250 * time.Millisecond
	// A podium of one is not a win (docs/SPEC.md Sprint Snob, default —
	// tune in alpha): someone else has to have sprinted.
	minSprintField = 2
)

// sprint is one armed sprint moment. Samples land here as they arrive during
// the window; the podium computes once, at the first tick past the end.
//
// Not goroutine-safe on its own — the owning room's mutex guards it.
type sprint struct {
	startsAt time.Time
	endsAt   time.Time
	samples  map[string][]int
	results  []protocol.SprintScore
	scored   bool
}

// armSprint replaces any previous sprint — re-arming is the coach's restart.
func (rm *room) armSprint(now time.Time) {
	rm.sprint = &sprint{
		startsAt: now.Add(sprintKlaxon),
		endsAt:   now.Add(sprintKlaxon + sprintWindow),
		samples:  make(map[string][]int),
	}
}

// collect records a sample that arrived inside the window.
func (sp *sprint) collect(riderID string, watts int, now time.Time) {
	if sp == nil || now.Before(sp.startsAt) || now.After(sp.endsAt) {
		return
	}
	// The window is 15 s at ~1 Hz per rider; a hostile client is already
	// rate-shaped by the read loop, but cap anyway.
	if len(sp.samples[riderID]) < 64 {
		sp.samples[riderID] = append(sp.samples[riderID], watts)
	}
}

// state renders the sprint for the tick, scoring it exactly once after the
// window and dropping it entirely once the podium has lingered.
func (sp *sprint) state(now time.Time, seen map[string]protocol.Rider) *protocol.SprintState {
	if sp == nil {
		return nil
	}
	if now.After(sp.endsAt.Add(sprintLinger)) {
		return nil
	}
	out := &protocol.SprintState{
		StartsAtMs: sp.startsAt.UnixMilli(),
		EndsAtMs:   sp.endsAt.UnixMilli(),
	}
	if now.After(sp.endsAt) {
		if !sp.scored {
			sp.results = podium(sp.samples, seen)
			sp.scored = true
		}
		out.Results = sp.results
	}
	return out
}

// podium ranks riders on best rolling 5 s w/kg (the SPEC sprint metric).
func podium(samples map[string][]int, seen map[string]protocol.Rider) []protocol.SprintScore {
	out := []protocol.SprintScore{}
	for riderID, watts := range samples {
		rider, ok := seen[riderID]
		if !ok || rider.WeightKg <= 0 || len(watts) == 0 {
			continue
		}
		window := 5
		if len(watts) < window {
			window = len(watts)
		}
		sum := 0
		for i := 0; i < window; i++ {
			sum += watts[i]
		}
		best := sum
		for i := window; i < len(watts); i++ {
			sum += watts[i] - watts[i-window]
			if sum > best {
				best = sum
			}
		}
		avg := best / window
		out = append(out, protocol.SprintScore{
			RiderID: riderID, Name: rider.Name,
			Watts: avg, Wkg: float64(avg) / float64(rider.WeightKg),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Wkg > out[j].Wkg })
	return out
}
