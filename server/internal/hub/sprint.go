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
	// The last wall-clock second each rider landed a sample in: the podium
	// is best 5 s w/kg (docs/SPEC.md), and five *packets* from a trainer
	// notifying at 4 Hz were 1.25 s (audit 2026-09-09).
	seconds map[string]int64
}

// armSprint arms the coach button's sprint: the klaxon lead, then SPEC's
// 15 s. Replaces any previous sprint — re-arming is the coach's restart.
func (rm *room) armSprint(now time.Time) {
	rm.armSprintWindow(now.Add(sprintKlaxon), now.Add(sprintKlaxon+sprintWindow))
}

// armSprintWindow arms a sprint over an explicit window. The workout
// timeline arms this way (#2016): the block carries its own length and its
// own place on the timeline, so neither the 15 s nor `now` is the answer.
func (rm *room) armSprintWindow(startsAt, endsAt time.Time) {
	rm.sprint = &sprint{
		startsAt: startsAt,
		endsAt:   endsAt,
		samples:  make(map[string][]int),
	}
}

// collect records a sample that arrived inside the window.
func (sp *sprint) collect(riderID string, watts int, now time.Time) {
	if sp == nil || now.Before(sp.startsAt) || now.After(sp.endsAt) {
		return
	}
	if sp.seconds == nil {
		sp.seconds = make(map[string]int64)
	}
	second := now.Unix()
	if last, ok := sp.seconds[riderID]; ok && second <= last {
		return
	}
	sp.seconds[riderID] = second
	// The window is 15 s at one sample a second per rider; cap anyway.
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
		// Best 5 s means five seconds: a rider with fewer samples in the
		// window is not ranked on a shorter one — stats.PowerCurve answers
		// the same question with zero (audit 2026-09-09).
		window := 5
		if len(watts) < window {
			continue
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
	// Ties by rider id, not map order: two riders on the same w/kg used to
	// take 5 and 3 points at random (#824).
	// ponytail: id is stable, not the SPEC's medal rule (earlier joiner);
	// that needs the room's seenOrder threaded through every mode's advance.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Wkg != out[j].Wkg {
			return out[i].Wkg > out[j].Wkg
		}
		return out[i].RiderID < out[j].RiderID
	})
	return out
}
