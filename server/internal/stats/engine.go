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
		band := protocol.TargetBand(target)
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

// LTHRRideWindow is SPEC's measuring window for the LTHR-from-a-ride
// suggestion: the last 20 minutes, one sample a second. MinLTHRRideSeconds is
// the ride length that qualifies at all — Friel's 30-minute time trial.
const (
	LTHRRideWindow     = 20 * 60
	MinLTHRRideSeconds = 30 * 60
)

// Last20mHR is the average heart rate over a ride's LAST 20 minutes — the
// number Friel's 30-minute field test reads (docs/SPEC.md, RESEARCH §17.2).
//
// This is not a curve window. `curve` holds best5s/best1m/best5m/best20m,
// which are BEST-of-window; the field test asks for the LAST window, and on
// any ride that was not a time trial those are different numbers.
//
// Seconds with no reading are not averaged: a strap that dropped for ten
// seconds recorded nothing there, and counting those as 0 bpm would pull the
// average down by a tenth of nothing the rider did. A ride shorter than the
// window, or one that read for less than half of it, honestly has no number
// — 0, the same posture PowerCurve takes on a window longer than the ride.
//
// The half is SPEC's and it is not fussiness. Skipping absent seconds with no
// floor under the count means one second of readings IS the average: a strap
// that re-acquires in the last minute with a single spurious 180 stores 180,
// clears every gate below, and asks the rider to adopt it as their threshold
// for the next 90 days — silently, because nothing tells them how little of
// the window it came from.
func Last20mHR(samples []protocol.RiderMetrics) int {
	if len(samples) < LTHRRideWindow {
		return 0
	}
	sum, beats := 0, 0
	for _, sample := range samples[len(samples)-LTHRRideWindow:] {
		if sample.HR > 0 {
			sum += sample.HR
			beats++
		}
	}
	if beats*2 < LTHRRideWindow {
		return 0
	}
	return int(math.Round(float64(sum) / float64(beats)))
}

// SuggestLTHR is docs/SPEC.md's LTHR-from-a-ride rule (#1620): when the
// largest last-20-minute average HR among the rider's qualifying 90-day rides
// exceeds the set LTHR by more than 2 %, suggest — never auto-apply, and
// never outside the profile's own bounds, which is what keeps a misreporting
// strap out of the prompt. Which rides qualify (solo, ≥ 30 min, HR present)
// is the query's job; this is the arithmetic.
//
// Deliberately no power term. SPEC says so and says why: a rider riding the
// protocol honestly need not be near their best 20-minute power, so a power
// gate would skip the very test this exists to catch.
//
// The lower bound is defence in depth rather than a live guard: today the
// column holds only 0 (caught by currentLthr's own check, since a rider with
// no LTHR is not asked at all) or a real reading, and the profile refuses an
// LTHR under MinLthrBpm. It costs a comparison and it is what a future that
// lets the anchor go lower will want.
func SuggestLTHR(last20mHR, currentLthr int) (int, bool) {
	if currentLthr <= 0 || last20mHR < protocol.MinLthrBpm || last20mHR > protocol.MaxLthrBpm {
		return 0, false
	}
	if float64(last20mHR) <= float64(currentLthr)*1.02 {
		return 0, false
	}
	return last20mHR, true
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
