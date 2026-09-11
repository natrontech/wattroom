// Package stats is the ride-completion pipeline (#25): formulas are
// docs/SPEC.md's; nothing here invents a number. The target math itself lives
// in internal/workout, shared with the hub's live meter (#27).
package stats

import (
	"fmt"
	"math"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Execution is docs/SPEC.md's score: % of riding seconds inside the tolerance
// band (±5 %, floor ±10 W), each second weighted target/FTP so nailing VO2
// counts more than nailing recovery. Warmup/cooldown/freeride excluded; a
// second with no power is a second not ridden and is excluded too (the
// auto-pause exclusion, seen from the server side).
//
// scorable says whether the WORKOUT prescribed anything to score, which is a
// different question from how the rider did. Three cases, and #1143 was the
// first two being answered as the third:
//
//   - the workout asks for targets and the rider hit some → the score
//   - the workout asks for targets and the rider produced no power on any of
//     them → 0, which is honest: they executed none of it
//   - the workout asks for nothing (only warmup, cooldown and sprints — no
//     steady step) → scorable is false and the score is meaningless. It used
//     to return 1 here, a PERFECT score for a ride nobody could score, which
//     was then stored, paid as XP, and won the Metronome medal off riders who
//     had actually ridden the intervals.
//
// A fourth case is the workout saying so itself (#1400): the ramp test
// prescribes 25 steady steps, so Scorable below says yes and the loop then
// scores a rider the trainer was holding on the target — near 1.0 by
// construction, the same pathology from the other end. A workout that
// declares itself unscored is answered before the loop, so no number reaches
// the row or the XP bonus.
func Execution(workoutJSON string, ftp float64, samples []protocol.RiderMetrics) (score float64, scorable bool, err error) {
	segments, err := workout.Parse(workoutJSON)
	if err != nil {
		return 0, false, fmt.Errorf("stats: workout json: %w", err)
	}
	if workout.Unscored(workoutJSON) {
		return 0, false, nil
	}
	scorable = Scorable(segments)
	var weight, inBand float64
	keyed := clockKeyed(samples)
	for i, sample := range samples {
		// The workout second: what the sample says when the ride stamped one
		// (#1733), the array index otherwise (a room ride, or an old record).
		second := i
		if keyed {
			second = sample.Clock
		}
		target, scored := workout.TargetAt(segments, ftp, second)
		// SPEC's stopped predicate, the same one the live meter asks (#795):
		// excluding only 0 W here scored a soft-pedalled second as a miss
		// that the meter had dropped (audit 2026-09-09).
		if !scored || target <= 0 || !sample.Pedalling() || sample.Released {
			continue
		}
		// The same rule the live score uses (hub/accumulator): the band is
		// the rider's own biased target, the weight is the prescribed
		// intensity. Live and saved must agree, or a rider watches one number
		// all session and is handed another (#795).
		wgt := target / ftp
		target *= sample.BiasOr()
		band := math.Max(target*0.05, 10)
		weight += wgt
		if math.Abs(float64(sample.Watts)-target) <= band {
			inBand += wgt
		}
	}
	if weight == 0 {
		// No second counted. Either the workout had nothing to score
		// (scorable is false and the caller must not use this number), or the
		// rider produced no power against targets that existed — and 0 is the
		// honest answer to that one.
		return 0, scorable, nil
	}
	return inBand / weight, scorable, nil
}

// clockKeyed says whether the ride stamped its samples with the workout second
// (protocol.RiderMetrics.Clock). Any non-zero stamp is the signal: a client
// that sends the field sends it on every sample, and the only sample it is
// legitimately 0 on is the first.
func clockKeyed(samples []protocol.RiderMetrics) bool {
	for _, sample := range samples {
		if sample.Clock > 0 {
			return true
		}
	}
	return false
}

// Scorable reports whether a workout prescribes any second the execution score
// can be computed from. Only a steady step carries a target (workout.TargetAt);
// warmup, cooldown, ramp and sprint ask for effort rather than a number.
func Scorable(segments []workout.Segment) bool {
	for _, seg := range segments {
		if seg.Kind == "steady" && (seg.Watts > 0 || seg.Target > 0) {
			return true
		}
	}
	return false
}

// Curve is the best-effort power curve (SPEC windows).
type Curve struct {
	Best5s  int `json:"best5s"`
	Best1m  int `json:"best1m"`
	Best5m  int `json:"best5m"`
	Best20m int `json:"best20m"`
}

// PowerCurve computes rolling-window bests; a window longer than the ride is
// honestly zero, never extrapolated.
func PowerCurve(watts []int) Curve {
	best := func(window int) int {
		if len(watts) < window {
			return 0
		}
		sum := 0
		for i := 0; i < window; i++ {
			sum += watts[i]
		}
		top := sum
		for i := window; i < len(watts); i++ {
			sum += watts[i] - watts[i-window]
			if sum > top {
				top = sum
			}
		}
		return int(math.Round(float64(top) / float64(window)))
	}
	return Curve{
		Best5s: best(5), Best1m: best(60), Best5m: best(300), Best20m: best(1200),
	}
}

// XP per docs/SPEC.md: 1 kJ = 1 XP plus execution% × 50. The streak bonus
// belongs to the streak feature (#29) and lands there, not invented here.
func XP(kj int, execution float64) int {
	return kj + int(math.Round(execution*50))
}

// Category from best 20-min w/kg (SPEC): D < 2.5, C 2.5–3.2, B 3.2–4.0, A ≥ 4.0.
func Category(best20mWatts int, kg float64) string {
	if kg <= 0 || best20mWatts <= 0 {
		return "D"
	}
	wkg := float64(best20mWatts) / kg
	switch {
	case wkg >= 4.0:
		return "A"
	case wkg >= 3.2:
		return "B"
	case wkg >= 2.5:
		return "C"
	default:
		return "D"
	}
}

// The bounds an FTP has to sit inside, in watts. The same pair lives in the
// users and rides CHECKs and in the profile form (web PROFILE_LIMITS); named
// here because a second handler now asks for it — the FTP a ramp test produced
// on its own ride (#1572), beside the profile write that always did.
const (
	MinFtpWatts = 50
	MaxFtpWatts = 600
)

// SuggestFTP is docs/SPEC.md's auto-detect rule: when 0.95 × the 90-day best
// 20-min exceeds the set FTP by more than 2 %, suggest — never auto-apply,
// because FTP moves every workout's difficulty.
func SuggestFTP(best20m, currentFtp int) (int, bool) {
	suggested := int(math.Round(0.95 * float64(best20m)))
	if currentFtp <= 0 || float64(suggested) <= float64(currentFtp)*1.02 {
		return 0, false
	}
	return suggested, true
}

// zoneTops are the upper edges of Z1–Z6 as fractions of FTP (docs/SPEC.md's
// Coggan table, the same numbers web/src/lib/components/zones.ts bands live
// power with); Z7 is open-ended.
var zoneTops = [...]float64{0.55, 0.75, 0.9, 1.05, 1.2, 1.5}

// PowerZone is the zone one wattage sits in, 1–7. A non-positive FTP has no
// zones to speak of, so everything is Z1 rather than a divide by zero.
func PowerZone(watts, ftp int) int {
	if ftp <= 0 {
		return 1
	}
	fraction := float64(watts) / float64(ftp)
	for i, top := range zoneTops {
		if fraction <= top {
			return i + 1
		}
	}
	return 7
}
