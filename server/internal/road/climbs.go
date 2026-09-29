package road

import (
	"math"
	"sort"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Climb is one climb on a stored road (#3238): the twin of $lib/road's, so
// the server — which creates a climb's shared identity (#3137) and times
// efforts on it (#3139) — finds exactly the climbs the rider's screen drew.
type Climb struct {
	// Metres along the road where it starts and where it tops out, and the
	// metres it gains, floored to the centimetre: the numbers its key reads.
	StartM float64 `json:"startM"`
	TopM   float64 `json:"topM"`
	GainM  float64 `json:"gainM"`
	// Class is IV, III, II, I or HC; empty below IV.
	Class string `json:"cls"`
}

// ClimbsOf runs docs/SPEC.md's climb rule on the road's heights, step for
// step as $lib/road's climbsOf does. Every operation is one of the four
// IEEE-exact ones or a floor, in the same order, so the two land on the same
// centimetre from the same bytes; the golden vectors in protocol/testdata
// hold them to it.
func ClimbsOf(r Road) []Climb {
	h := r.Heights
	step := r.Step()
	type found struct {
		c Climb
		k int
	}
	var all []found
	for i := 0; i < len(h)-1; {
		// Down to the foot of the next rise.
		for i < len(h)-1 && h[i+1] <= h[i] {
			i++
		}
		start, top := i, i
		for j := i + 1; j < len(h); j++ {
			if h[j] > h[top] {
				top = j
			} else if h[j] <= h[start] {
				start, top = j, j
			} else if h[top]-h[j] >= protocol.ClimbDipLossM || float64(j-top)*step >= protocol.ClimbDipM {
				break
			}
		}
		// The earliest start whose average to the top still holds the grade.
		for start < top && !(h[top]-h[start] >= float64(protocol.ClimbMinPct)/100*float64(top-start)*step) {
			start++
		}
		length := float64(top-start) * step
		gain := floorCm(h[top] - h[start])
		if length >= protocol.ClimbMinM && 100*gain >= protocol.ClimbMinScore {
			all = append(all, found{Climb{
				StartM: floorCm(float64(start) * step),
				TopM:   floorCm(float64(top) * step),
				GainM:  gain,
				Class:  ClimbClass(100 * gain),
			}, len(all)})
		}
		i = max(top, i+1)
	}
	// The hardest MaxClimbs, in road order.
	sort.SliceStable(all, func(a, b int) bool { return all[a].c.GainM > all[b].c.GainM })
	all = all[:min(len(all), protocol.MaxClimbs)]
	sort.SliceStable(all, func(a, b int) bool { return all[a].k < all[b].k })
	out := make([]Climb, len(all))
	for i, f := range all {
		out[i] = f.c
	}
	return out
}

// ClimbClass is the class a climb's score holds: the hardest whose floor it
// is above, or none below IV.
func ClimbClass(score float64) string {
	for _, c := range []struct {
		name  string
		floor float64
	}{
		{"HC", protocol.ClimbClassHC},
		{"I", protocol.ClimbClassI},
		{"II", protocol.ClimbClassII},
		{"III", protocol.ClimbClassIII},
		{"IV", protocol.ClimbClassIV},
	} {
		if score > c.floor {
			return c.name
		}
	}
	return ""
}

// floorCm floors metres to the centimetre, as #3224's keys take a length.
func floorCm(m float64) float64 { return math.Floor(m*100) / 100 }
