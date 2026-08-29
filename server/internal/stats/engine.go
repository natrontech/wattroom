// Package stats is the ride-completion pipeline (#25): when a room session
// closes, each rider's accumulated samples become one durable ride — samples
// compressed to a blob, power curve, execution score, XP — in one transaction.
// Formulas are docs/SPEC.md's; nothing here invents a number.
package stats

import (
	"encoding/json"
	"fmt"
	"math"
)

// Step mirrors the docs/SPEC.md workout JSON — the same shape the web engine
// runs. The server needs it only to know the target at a given second, so the
// execution score can be computed where the samples land.
type Step struct {
	Type    string  `json:"type"`
	Seconds int     `json:"seconds"`
	Target  float64 `json:"target,omitempty"`
	Watts   float64 `json:"watts,omitempty"`
	From    float64 `json:"from,omitempty"`
	To      float64 `json:"to,omitempty"`
	Times   int     `json:"times,omitempty"`
	Steps   []Step  `json:"steps,omitempty"`
}

type workout struct {
	Name  string `json:"name"`
	Steps []Step `json:"steps"`
}

// segment is one flattened block on the timeline.
type segment struct {
	kind    string
	start   int
	seconds int
	target  float64 // fraction of FTP unless watts is set (absolute)
	watts   float64
	from    float64
	to      float64
}

// flattenWorkout mirrors the web engine's flatten — repeats expand, nesting
// allowed. The workout arrived over the room WS already bounded.
func flattenWorkout(steps []Step, at int) ([]segment, int) {
	out := []segment{}
	for _, s := range steps {
		switch s.Type {
		case "repeat":
			for i := 0; i < s.Times; i++ {
				inner, next := flattenWorkout(s.Steps, at)
				out = append(out, inner...)
				at = next
			}
		default:
			out = append(out, segment{
				kind: s.Type, start: at, seconds: s.Seconds,
				target: s.Target, watts: s.Watts, from: s.From, to: s.To,
			})
			at += s.Seconds
		}
	}
	return out, at
}

// targetAt is the shared timeline's target for one rider at one second.
// scored=false marks seconds the SPEC excludes: warmup, cooldown, freeride.
func targetAt(segments []segment, ftp float64, second int) (watts float64, scored bool) {
	for _, seg := range segments {
		if second < seg.start || second >= seg.start+seg.seconds {
			continue
		}
		switch seg.kind {
		case "steady":
			if seg.watts > 0 {
				return seg.watts, true
			}
			return seg.target * ftp, true
		case "warmup", "cooldown":
			progress := float64(second-seg.start) / float64(seg.seconds)
			return (seg.from + (seg.to-seg.from)*progress) * ftp, false
		default:
			return 0, false
		}
	}
	return 0, false
}

// Execution is docs/SPEC.md's score: % of riding seconds inside the tolerance
// band (±5 %, floor ±10 W), each second weighted target/FTP so nailing VO2
// counts more than nailing recovery. Warmup/cooldown/freeride excluded; a
// second with no power is a second not ridden and is excluded too (the
// auto-pause exclusion, seen from the server side).
func Execution(workoutJSON string, ftp float64, watts []int) (float64, error) {
	var w workout
	if err := json.Unmarshal([]byte(workoutJSON), &w); err != nil {
		return 0, fmt.Errorf("stats: workout json: %w", err)
	}
	segments, _ := flattenWorkout(w.Steps, 0)
	var weight, inBand float64
	for second, sample := range watts {
		target, scored := targetAt(segments, ftp, second)
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
