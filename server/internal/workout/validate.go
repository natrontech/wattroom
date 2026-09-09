package workout

import (
	"encoding/json"
	"fmt"
)

// refusal is a rider-facing sentence, which is why it may end in a full stop
// where a Go error would not: it is the message the API sends back verbatim.
type refusal string

func (r refusal) Error() string { return string(r) }

// The editor's LIMITS (web/src/lib/workout/validate.ts), at the boundary.
// They were client-only: a workout written through the API with a two-second
// step or a 2500 % target was stored, counted as yours, and then vanished
// from the shelf without a word when the client refused to read it (audit
// 2026-09-09). Product numbers come from docs/SPEC.md (cadence, HR, the
// spiral guard); the rest are the editor's ceilings.
const (
	minStepSeconds   = 5
	maxStepSeconds   = 4 * 60 * 60
	maxFraction      = 3.0
	maxWatts         = 3000
	minCadence       = 30
	maxCadence       = 150
	guardTripCadence = 50
	minHr            = 60
	maxHr            = 220
)

// Validate is the per-step half of the boundary: Parse proves the JSON
// expands, this proves every step is one the engine and the editor agree
// on. The error is written for the rider — it names the step — and is safe
// to send as the message.
func Validate(workoutJSON string) error {
	var d definition
	if err := json.Unmarshal([]byte(workoutJSON), &d); err != nil {
		return refusal("That is not a workout the engine can ride.")
	}
	if len(d.Steps) == 0 {
		return refusal("A workout needs at least one step.")
	}
	for i, s := range d.Steps {
		if err := checkStep(s, fmt.Sprintf("Step %d", i+1), 0); err != nil {
			return err
		}
	}
	return nil
}

func checkStep(s Step, where string, depth int) error {
	switch s.Type {
	case "warmup", "cooldown", "ramp":
		if err := checkSeconds(s.Seconds, where); err != nil {
			return err
		}
		if err := checkFraction(s.From, where, "from"); err != nil {
			return err
		}
		return checkFraction(s.To, where, "to")
	case "steady":
		if err := checkSeconds(s.Seconds, where); err != nil {
			return err
		}
		if err := checkBand(s.CadenceLow, s.CadenceHigh, minCadence, maxCadence, "rpm", where); err != nil {
			return err
		}
		if s.CadenceLow != 0 && s.CadenceLow <= guardTripCadence {
			return refusal(fmt.Sprintf("%s: a %d rpm floor sits at the spiral guard's %d rpm trip — the guard would fight the workout.", where, s.CadenceLow, guardTripCadence))
		}
		if err := checkBand(s.HrLow, s.HrHigh, minHr, maxHr, "bpm", where); err != nil {
			return err
		}
		if s.Watts != 0 {
			if s.Watts < 0 || s.Watts > maxWatts {
				return refusal(fmt.Sprintf("%s: %.0f W is outside 1–%d.", where, s.Watts, maxWatts))
			}
			return nil
		}
		return checkFraction(s.Target, where, "target")
	case "sprint":
		return checkSeconds(s.Seconds, where)
	case "repeat":
		if depth >= maxDepth {
			return refusal(fmt.Sprintf("%s: repeats are nested more than %d deep.", where, maxDepth))
		}
		if s.Times < 1 || s.Times > maxRepeats {
			return refusal(fmt.Sprintf("%s: %d repeats is outside 1–%d.", where, s.Times, maxRepeats))
		}
		if len(s.Steps) == 0 {
			return refusal(fmt.Sprintf("%s: a repeat needs at least one step.", where))
		}
		for i, inner := range s.Steps {
			if err := checkStep(inner, fmt.Sprintf("%s → step %d", where, i+1), depth+1); err != nil {
				return err
			}
		}
		return nil
	default:
		return refusal(fmt.Sprintf("%s: unknown step type %q.", where, s.Type))
	}
}

func checkSeconds(seconds int, where string) error {
	if seconds < minStepSeconds {
		return refusal(fmt.Sprintf("%s: steps shorter than %ds are not rideable.", where, minStepSeconds))
	}
	if seconds > maxStepSeconds {
		return refusal(fmt.Sprintf("%s: step is longer than %d hours.", where, maxStepSeconds/3600))
	}
	return nil
}

func checkFraction(value float64, where, field string) error {
	if value <= 0 {
		return refusal(fmt.Sprintf("%s: %s must be above 0.", where, field))
	}
	if value > maxFraction {
		return refusal(fmt.Sprintf("%s: %s is %.0f%% of FTP, above the %.0f%% ceiling.", where, field, value*100, maxFraction*100))
	}
	return nil
}

// A band is optional on either side; 0 is "nobody said" (Step's own rule).
func checkBand(low, high, min, max int, unit, where string) error {
	for _, v := range []int{low, high} {
		if v != 0 && (v < min || v > max) {
			return refusal(fmt.Sprintf("%s: %d %s is outside %d–%d.", where, v, unit, min, max))
		}
	}
	if low != 0 && high != 0 && low > high {
		return refusal(fmt.Sprintf("%s: the %s band is upside down (%d > %d).", where, unit, low, high))
	}
	return nil
}
