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
	// Coefficient of variation of power across steady steps (Diesel).
	CoV float64
	// Best rolling 5 s in w/kg (Hammer, and the Lanterne Rouge podium metric).
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

	best := func(better func(a, b RiderResult) bool) string {
		winner := byJoin[0]
		for _, r := range byJoin[1:] {
			if better(r, winner) {
				winner = r
			}
		}
		return winner.UserID
	}

	out := map[string]string{
		"diesel":    best(func(a, b RiderResult) bool { return a.CoV < b.CoV }),
		"metronome": best(func(a, b RiderResult) bool { return a.Execution > b.Execution }),
		"hammer":    best(func(a, b RiderResult) bool { return a.Best5sWkg > b.Best5sWkg }),
		// Last on the podium metric but completed — celebrated, not shamed.
		"lanterne_rouge": best(func(a, b RiderResult) bool { return a.Best5sWkg < b.Best5sWkg }),
	}
	return out
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
