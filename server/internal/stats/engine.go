// Package stats is the ride-completion pipeline (#25): formulas are
// docs/SPEC.md's; nothing here invents a number. The target math itself lives
// in internal/workout, shared with the hub's live meter (#27).
package stats

import (
	"fmt"
	"math"

	"github.com/natrontech/wattroom/server/internal/workout"
)

// Execution is docs/SPEC.md's score: % of riding seconds inside the tolerance
// band (±5 %, floor ±10 W), each second weighted target/FTP so nailing VO2
// counts more than nailing recovery. Warmup/cooldown/freeride excluded; a
// second with no power is a second not ridden and is excluded too (the
// auto-pause exclusion, seen from the server side).
func Execution(workoutJSON string, ftp float64, watts []int) (float64, error) {
	segments, err := workout.Parse(workoutJSON)
	if err != nil {
		return 0, fmt.Errorf("stats: workout json: %w", err)
	}
	var weight, inBand float64
	for second, sample := range watts {
		target, scored := workout.TargetAt(segments, ftp, second)
		if !scored || target <= 0 || sample <= 0 {
			continue
		}
		band := math.Max(target*0.05, 10)
		wgt := target / ftp
		weight += wgt
		if math.Abs(float64(sample)-target) <= band {
			inBand += wgt
		}
	}
	if weight == 0 {
		return 1, nil
	}
	return inBand / weight, nil
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
