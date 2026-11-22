package workout

import (
	"bytes"
	"encoding/json"
	"math"
)

// Relative rewrites a workout's absolute-watts steady steps as fractions of
// ftp, the FTP of the rider who picked it for a session. A session's workout
// is ridden by everyone in it at their own FTP (docs/spec/workouts.md); a
// step in watts (an .erg import, a planned workout) would otherwise hand a
// 200 W rider the 160 W coach's numbers. Every other field is kept. The
// workout comes back unchanged when it has no watts step, when ftp is not
// positive, when it declares itself unscored (the ramp test's ladder is
// absolute on purpose), and when it does not parse.
func Relative(workoutJSON string, ftp int) string {
	if ftp <= 0 || Unscored(workoutJSON) {
		return workoutJSON
	}
	dec := json.NewDecoder(bytes.NewReader([]byte(workoutJSON)))
	dec.UseNumber()
	var def map[string]any
	if err := dec.Decode(&def); err != nil {
		return workoutJSON
	}
	if !relativeSteps(def["steps"], float64(ftp)) {
		return workoutJSON
	}
	out, err := json.Marshal(def)
	if err != nil {
		return workoutJSON
	}
	return string(out)
}

// relativeSteps rewrites steps in place, repeats included, and reports
// whether it changed any.
func relativeSteps(v any, ftp float64) bool {
	steps, ok := v.([]any)
	if !ok {
		return false
	}
	changed := false
	for _, raw := range steps {
		step, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if relativeSteps(step["steps"], ftp) {
			changed = true
		}
		// A heart-rate hold moves its own watts and rides alone.
		if step["type"] != "steady" || step["hrHold"] == true {
			continue
		}
		n, ok := step["watts"].(json.Number)
		if !ok {
			continue
		}
		watts, err := n.Float64()
		if err != nil || watts <= 0 {
			continue
		}
		fraction := math.Round(watts/ftp*1000) / 1000
		step["target"] = min(max(fraction, 0.01), maxFraction)
		delete(step, "watts")
		changed = true
	}
	return changed
}
