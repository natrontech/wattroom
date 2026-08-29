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
			progress := float64(second-seg.Start) / float64(seg.Seconds)
			return (seg.From + (seg.To-seg.From)*progress) * ftp, false
		default:
			return 0, false
		}
	}
	return 0, false
}
