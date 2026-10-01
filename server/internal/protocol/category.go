package protocol

import "math"

// Category and the FTP suggestion are docs/SPEC.md's stats formulas, here
// rather than in stats because a race's flag reads both inside the hub
// (#3658), which stats itself depends on.

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
