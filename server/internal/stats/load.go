package stats

import (
	"math"
	"time"
)

// Training-load math per docs/SPEC.md (Training load) and ADR-0014: Coggan's
// published formulas under trademark-safe names. Nothing here invents a number.

// normPowerMinSeconds: below 20 min the rolling-4th-power estimate is not
// meaningful (SPEC) — NormPower falls back to plain average power.
const normPowerMinSeconds = 20 * 60

// NormPower is the 30 s rolling average of 1 Hz power, each value to the 4th
// power, meaned, 4th-rooted. Short rides return plain average power.
func NormPower(watts []int) int {
	if len(watts) == 0 {
		return 0
	}
	if len(watts) < normPowerMinSeconds {
		sum := 0
		for _, w := range watts {
			sum += w
		}
		return int(math.Round(float64(sum) / float64(len(watts))))
	}
	const window = 30
	var rollSum int
	var mean4 float64
	n := 0
	for i, w := range watts {
		rollSum += w
		if i >= window {
			rollSum -= watts[i-window]
		}
		if i >= window-1 {
			avg := float64(rollSum) / window
			mean4 += avg * avg * avg * avg
			n++
		}
	}
	return int(math.Round(math.Pow(mean4/float64(n), 0.25)))
}

// Load is Intensity² × hours × 100 — one hour exactly at FTP = 100.
func Load(normWatts, ftpWatts, seconds int) float64 {
	if normWatts <= 0 || ftpWatts <= 0 || seconds <= 0 {
		return 0
	}
	intensity := float64(normWatts) / float64(ftpWatts)
	return intensity * intensity * (float64(seconds) / 3600) * 100
}

// FormPoint is one day of the Fitness/Fatigue/Form series.
type FormPoint struct {
	Date    string  `json:"date"` // UTC day, YYYY-MM-DD
	Fitness float64 `json:"fitness"`
	Fatigue float64 `json:"fatigue"`
	Form    float64 `json:"form"`
}

// FitnessSeries runs the 42/7-day EWMAs over daily Load from the first ride
// day through today (UTC days; a day without rides is 0). dailyLoad keys are
// YYYY-MM-DD.
func FitnessSeries(dailyLoad map[string]float64, first, today time.Time) []FormPoint {
	first = first.UTC().Truncate(24 * time.Hour)
	today = today.UTC().Truncate(24 * time.Hour)
	if today.Before(first) {
		return nil
	}
	var fitness, fatigue float64
	out := make([]FormPoint, 0, int(today.Sub(first).Hours()/24)+1)
	for d := first; !d.After(today); d = d.AddDate(0, 0, 1) {
		form := fitness - fatigue // yesterday's values, deliberately (SPEC)
		load := dailyLoad[d.Format(time.DateOnly)]
		fitness += (load - fitness) / 42
		fatigue += (load - fatigue) / 7
		out = append(out, FormPoint{
			Date: d.Format(time.DateOnly), Fitness: fitness, Fatigue: fatigue, Form: form,
		})
	}
	return out
}

// FormZone maps percentage form (form / fitness × 100) onto SPEC's five
// zones. Zone words describe the day, never the rider (ADR-0014).
func FormZone(formPct float64) string {
	switch {
	case formPct > 20:
		return "transition"
	case formPct >= 5:
		return "fresh"
	case formPct >= -10:
		return "grey"
	case formPct >= -30:
		return "optimal"
	default:
		return "high_risk"
	}
}
