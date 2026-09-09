package stats

import (
	"math"
	"sort"

	"github.com/natrontech/wattroom/server/internal/workout"
)

// minRidersForMedals is docs/SPEC.md's default — tune in alpha.
const minRidersForMedals = 3

// RiderResult is what medal criteria are judged on, computed per rider at
// session close.
type RiderResult struct {
	UserID    string
	JoinOrder int // ties: earlier joiner wins (SPEC)
	Execution float64
	// Scored says the workout gave this rider something to score. Metronome is
	// "best execution score", so a rider with no score is not in that race —
	// #1143, where an unscorable ride reported 1.0 and won it outright.
	Scored bool
	// Coefficient of variation of power across steady steps (Diesel).
	CoV float64
	// Best rolling 5 s in w/kg (Hammer, and the Lanterne Rouge podium metric).
	// Zero means "no power reported", which is an absence rather than a result:
	// SPEC's Lanterne Rouge is LAST on the podium metric, and a rider with no
	// value for it was never on the podium to be last on.
	Best5sWkg float64
	Completed bool
}

// Medals awards per docs/SPEC.md. Fewer than three riders: no medals at all.
func Medals(results []RiderResult) map[string]string {
	completed := make([]RiderResult, 0, len(results))
	for _, r := range results {
		if r.Completed {
			completed = append(completed, r)
		}
	}
	if len(completed) < minRidersForMedals {
		return nil
	}

	// Stable tie-break: earlier joiner first, then the criterion decides.
	byJoin := make([]RiderResult, len(completed))
	copy(byJoin, completed)
	sort.Slice(byJoin, func(i, j int) bool { return byJoin[i].JoinOrder < byJoin[j].JoinOrder })

	// Every medal here is measured off power, so a rider who reported none has
	// no value for any of them — and zero is not a good result, it is an
	// absence (#1143). Left in, a dead power meter reads as perfectly steady
	// (Diesel, CoV 0) and as the slowest rider (Lanterne Rouge, 0 w/kg), and
	// took both off riders who had actually ridden.
	rode := filter(byJoin, func(r RiderResult) bool { return r.Best5sWkg > 0 })
	out := map[string]string{}
	if len(rode) > 0 {
		out["diesel"] = bestOf(rode, func(a, b RiderResult) bool { return a.CoV < b.CoV })
		out["hammer"] = bestOf(rode, func(a, b RiderResult) bool { return a.Best5sWkg > b.Best5sWkg })
		// Last on the podium metric but completed — celebrated, not shamed.
		out["lanterne_rouge"] = bestOf(rode, func(a, b RiderResult) bool { return a.Best5sWkg < b.Best5sWkg })
	}
	// Metronome is best EXECUTION, which asks the further question of whether
	// the workout prescribed anything at all. On a session that scored nothing
	// for anybody the medal is simply not awarded, rather than handed to
	// whoever joined first on a field of tied zeroes.
	if scored := filter(rode, func(r RiderResult) bool { return r.Scored }); len(scored) > 0 {
		out["metronome"] = bestOf(scored, func(a, b RiderResult) bool { return a.Execution > b.Execution })
	}
	return out
}

// filter keeps join order, which is what the tie-break depends on.
func filter(rs []RiderResult, keep func(RiderResult) bool) []RiderResult {
	out := make([]RiderResult, 0, len(rs))
	for _, r := range rs {
		if keep(r) {
			out = append(out, r)
		}
	}
	return out
}

// bestOf is best() over an explicit slice: first in join order wins a tie.
func bestOf(rs []RiderResult, better func(a, b RiderResult) bool) string {
	winner := rs[0]
	for _, r := range rs[1:] {
		if better(r, winner) {
			winner = r
		}
	}
	return winner.UserID
}

// SteadyCoV is Diesel's criterion: stddev/mean of power over the seconds that
// fall in steady segments. No steady seconds ridden → worst possible (MaxFloat),
// never a division by zero.
func SteadyCoV(segments []workout.Segment, watts []int) float64 {
	var values []float64
	for second, w := range watts {
		if w <= 0 {
			continue
		}
		for _, seg := range segments {
			if seg.Kind == "steady" && second >= seg.Start && second < seg.Start+seg.Seconds {
				values = append(values, float64(w))
				break
			}
		}
	}
	if len(values) < 2 {
		return math.MaxFloat64
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	mean := sum / float64(len(values))
	if mean == 0 {
		return math.MaxFloat64
	}
	var variance float64
	for _, v := range values {
		variance += (v - mean) * (v - mean)
	}
	return math.Sqrt(variance/float64(len(values))) / mean
}
