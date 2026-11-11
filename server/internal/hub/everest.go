package hub

import (
	"math"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Everest together (#3193, docs/spec/roads.md "Road stats"): a Ride together
// session sums the metres its riders climb while on it, toward Everest. Each
// rider's own screen counts their free ride's climb and says the running
// total on every sample; the hub keeps only how far each total moved while
// the rider rode the session, and the tick carries the one sum. No rider's
// share leaves the hub, and nothing is ranked. Live state, reset at each
// start and gone with the room.

// climbTally is one rider's part of the sum.
type climbTally struct {
	// Metres counted for the session so far.
	m float64
	// The free ride's own total at the last sample, and when it came.
	last float64
	at   time.Time
}

// everest is the session's tallies, by rider id. Bounded by the riders who
// joined it, like the record.
type everest map[string]*climbTally

// hear counts one sample's climb. The first sample a rider sends on the
// session is where their count starts: metres climbed before they joined are
// their free ride's, not the crew's. A total that falls is a new free ride (or
// one off its road), which counts again from zero. A rise is held to what a
// rider can climb in the time since the last sample, protocol.MaxClimbMps a
// second, so a client that says more is counted only that far.
func (e everest) hear(rider string, climbed float64, now time.Time) {
	t, ok := e[rider]
	if !ok {
		e[rider] = &climbTally{last: climbed, at: now}
		return
	}
	rise := climbed - t.last
	if rise < 0 {
		rise = climbed
	}
	seconds := math.Max(1, math.Ceil(now.Sub(t.at).Seconds()))
	t.m += math.Min(rise, seconds*protocol.MaxClimbMps)
	t.last, t.at = climbed, now
}

// sum is the session's metres climbed together, in whole metres.
func (e everest) sum() int {
	total := 0.0
	for _, t := range e {
		total += t.m
	}
	return int(math.Floor(total))
}

// everestTogetherLocked is the tick's EverestTogether: the sum on a Ride
// together session, kept past its end for the page it stays on, and nothing
// on any other. Caller holds rm.mu.
func (rm *channelState) everestTogetherLocked() int {
	if !rm.session.together {
		return 0
	}
	return rm.climbs.sum()
}
