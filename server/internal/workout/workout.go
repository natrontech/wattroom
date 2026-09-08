// Package workout is the server's copy of the docs/SPEC.md workout math —
// just enough to know the target at a given second, shared by the stats
// pipeline (#25) and the hub's live execution meter (#27).
package workout

import "encoding/json"

// Step mirrors the docs/SPEC.md workout JSON — the same shape the web engine runs.
type Step struct {
	Type    string  `json:"type"`
	Seconds int     `json:"seconds"`
	Target  float64 `json:"target,omitempty"`
	Watts   float64 `json:"watts,omitempty"`
	From    float64 `json:"from,omitempty"`
	To      float64 `json:"to,omitempty"`
	Times   int     `json:"times,omitempty"`
	Steps   []Step  `json:"steps,omitempty"`
	// The cadence band a steady block may carry (#66) — display-only to the
	// rider, but the server reads it too since #270: it is the only thing in
	// a workout that says what rpm the room is actually turning, which is
	// what music can be matched to. Absent is 0, meaning "nobody said".
	CadenceLow  int `json:"cadenceLow,omitempty"`
	CadenceHigh int `json:"cadenceHigh,omitempty"`
}

type definition struct {
	Name  string `json:"name"`
	Steps []Step `json:"steps"`
}

// Segment is one flattened block on the timeline.
type Segment struct {
	Kind    string
	Start   int
	Seconds int
	Target  float64 // fraction of FTP unless Watts is set (absolute)
	Watts   float64
	From    float64
	To      float64
	// The block's cadence band in rpm, 0 when the workout did not say (#66).
	CadenceLow  int
	CadenceHigh int
}

// Parse flattens a workout JSON into timeline segments.
func Parse(workoutJSON string) ([]Segment, error) {
	var d definition
	if err := json.Unmarshal([]byte(workoutJSON), &d); err != nil {
		return nil, err
	}
	out, _ := flatten(d.Steps, 0)
	return out, nil
}

func flatten(steps []Step, at int) ([]Segment, int) {
	out := []Segment{}
	for _, s := range steps {
		switch s.Type {
		case "repeat":
			for i := 0; i < s.Times; i++ {
				inner, next := flatten(s.Steps, at)
				out = append(out, inner...)
				at = next
			}
		default:
			out = append(out, Segment{
				Kind: s.Type, Start: at, Seconds: s.Seconds,
				Target: s.Target, Watts: s.Watts, From: s.From, To: s.To,
				CadenceLow: s.CadenceLow, CadenceHigh: s.CadenceHigh,
			})
			at += s.Seconds
		}
	}
	return out, at
}

// TargetAt is the shared timeline's target for one rider at one second.
// scored=false marks seconds the SPEC excludes: warmup, cooldown, freeride.
func TargetAt(segments []Segment, ftp float64, second int) (watts float64, scored bool) {
	for _, seg := range segments {
		if second < seg.Start || second >= seg.Start+seg.Seconds {
			continue
		}
		switch seg.Kind {
		case "steady":
			if seg.Watts > 0 {
				return seg.Watts, true
			}
			return seg.Target * ftp, true
		case "warmup", "cooldown":
			return seg.rampPct(second) * ftp, false
		default:
			return 0, false
		}
	}
	return 0, false
}

// rampPct is a warmup's or cooldown's fraction of FTP at one second — the
// only place the ramp is interpolated, so TargetAt and SegmentAt cannot
// drift apart on it.
func (s Segment) rampPct(second int) float64 {
	progress := float64(second-s.Start) / float64(s.Seconds)
	return s.From + (s.To-s.From)*progress
}

// SegmentAt is the block the timeline is inside at one second, with its
// target as a FRACTION of FTP. #270 needs the block itself — its cadence
// band — and not only the watts TargetAt hands back.
//
// An absolute-watts block reports pct 0: it asks every rider for the same
// number, so there is no fraction that describes the room. Same for sprint
// and freeride, which ask for effort rather than a target.
func SegmentAt(segments []Segment, second int) (seg Segment, pct float64, ok bool) {
	for _, s := range segments {
		if second < s.Start || second >= s.Start+s.Seconds {
			continue
		}
		switch s.Kind {
		case "steady":
			if s.Watts > 0 {
				return s, 0, true
			}
			return s, s.Target, true
		case "warmup", "cooldown":
			return s, s.rampPct(second), true
		default:
			return s, 0, true
		}
	}
	return Segment{}, 0, false
}
