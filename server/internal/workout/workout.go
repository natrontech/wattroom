// Package workout is the server's copy of the docs/SPEC.md workout math —
// just enough to know the target at a given second, shared by the stats
// pipeline (#25) and the hub's live execution meter (#27).
package workout

import (
	"encoding/json"
	"errors"
)

// The engine's ceilings, the same numbers the web editor's LIMITS enforce
// (validate.ts). They were client-only, which is not a boundary: a 200-byte
// POST nesting repeats could expand to billions of segments on the one VM
// (audit 2026-09-09).
const (
	maxDepth    = 4
	maxRepeats  = 50
	maxSegments = 200
)

// ErrTooBig is a workout the engine refuses to expand: too many repeats,
// nested too deep, or more blocks than any ride has.
var ErrTooBig = errors.New("workout expands past the engine's limits")

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
	// The HR band (#67): display-only and never scored (ADR-0008); read here
	// only so Validate can bound it the way the editor does.
	HrLow  int `json:"hrLow,omitempty"`
	HrHigh int `json:"hrHigh,omitempty"`
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
	budget := maxSegments
	out, _, err := flatten(d.Steps, 0, 0, &budget)
	return out, err
}

func flatten(steps []Step, at, depth int, budget *int) ([]Segment, int, error) {
	if depth > maxDepth {
		return nil, at, ErrTooBig
	}
	out := []Segment{}
	for _, s := range steps {
		switch s.Type {
		case "repeat":
			if s.Times < 0 || s.Times > maxRepeats {
				return nil, at, ErrTooBig
			}
			for i := 0; i < s.Times; i++ {
				inner, next, err := flatten(s.Steps, at, depth+1, budget)
				if err != nil {
					return nil, at, err
				}
				out = append(out, inner...)
				at = next
			}
		default:
			if s.Seconds < 0 {
				return nil, at, ErrTooBig
			}
			*budget--
			if *budget < 0 {
				return nil, at, ErrTooBig
			}
			out = append(out, Segment{
				Kind: s.Type, Start: at, Seconds: s.Seconds,
				Target: s.Target, Watts: s.Watts, From: s.From, To: s.To,
				CadenceLow: s.CadenceLow, CadenceHigh: s.CadenceHigh,
			})
			at += s.Seconds
		}
	}
	return out, at, nil
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
