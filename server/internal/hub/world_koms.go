package hub

import (
	"slices"
	"time"

	"github.com/natrontech/wattroom/server/internal/road"
)

// Road sprints at KOMs (#3102): the road arms the room's sprint moment, the
// one a coach's button and a workout's sprint block arm — the klaxon, the
// 15 s window at 4 Hz, best 5 s W/kg — as the bunch closes on the top of a
// real climb.

// docs/SPEC.md "Riding a road together" (defaults — tune in alpha).
const (
	komOpensBeforeTopM = 300
	komSpacing         = 5 * time.Minute
	maxKomsPerRide     = 6
)

// komClasses are the climbs a KOM sprint is held on: class III or harder.
var komClasses = []string{"III", "II", "I", "HC"}

// komOpenings is where each KOM sprint opens on the road in the direction
// ridden, in metres from its start, in order.
func komOpenings(profile road.Road, reverse bool) []float64 {
	if reverse {
		heights := slices.Clone(profile.Heights)
		slices.Reverse(heights)
		profile = road.Road{LengthM: profile.LengthM, Heights: heights}
	}
	var at []float64
	for _, c := range road.ClimbsOf(profile) {
		if slices.Contains(komClasses, c.Class) {
			at = append(at, max(0, c.TopM-komOpensBeforeTopM))
		}
	}
	slices.Sort(at)
	return at
}

// komAt is the first KOM opening at or past u metres ridden, laps unrolled
// (after it, when past is set); false when the road has none left.
func (b *bunch) komAt(u float64, past bool) (float64, bool) {
	if len(b.koms) == 0 {
		return 0, false
	}
	m, _ := b.place(u)
	for _, k := range b.koms {
		if k > m || k == m && !past {
			return u + k - m, true
		}
	}
	if !b.loop {
		return 0, false
	}
	return u + b.road.LengthM - m + b.koms[0], true
}

// komDue answers the next KOM's opening once the bunch is within lead of it
// at its speed, as the time left — none left if it is already passed — and
// moves on to the one after. Every opening is answered once.
func (b *bunch) komDue(lead time.Duration) (time.Duration, bool) {
	if !b.komLeft {
		return 0, false
	}
	u := b.fromM + b.pace.Distance
	eta := time.Duration(0)
	if b.komU > u {
		if b.pace.Speed <= 0 {
			return 0, false
		}
		if eta = time.Duration((b.komU - u) / b.pace.Speed * float64(time.Second)); eta > lead {
			return 0, false
		}
	}
	b.komU, b.komLeft = b.komAt(max(b.komU, u), true)
	return eta, true
}

// armKomLocked arms the room's sprint as the bunch closes on a KOM: the
// sprint opens as the bunch reaches it, never over a sprint still running,
// at most one every komSpacing and maxKomsPerRide in a ride. A KOM the
// limits pass over is let go, not held for later. Caller holds rm.mu.
func (rm *channelState) armKomLocked(now time.Time) {
	b := rm.session.bunch
	if b == nil || rm.session.phase != "running" {
		return
	}
	eta, due := b.komDue(sprintKlaxon)
	if !due || b.komsArmed >= maxKomsPerRide || !b.lastKom.IsZero() && now.Add(eta).Sub(b.lastKom) < komSpacing {
		return
	}
	if sp := rm.sprint; sp != nil && now.Before(sp.endsAt) {
		return
	}
	opens := now.Add(eta)
	rm.armSprintWindow(opens, opens.Add(sprintWindow))
	b.komsArmed++
	b.lastKom = opens
}
