package stats

import (
	"encoding/json"
	"sort"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Block is one block of the workout a ride was ridden to, kept with the ride
// for its picture (#4430): from Start for Seconds workout seconds, its target
// going From → To watts at the FTP the ride was scored on. A block with no
// target in watts (free riding, a sprint, a heart-rate hold, the road) is 0
// to 0. The ride keeps its samples and never the workout, so without these
// the picture of a workout could only draw what was ridden, never what was
// asked.
type Block struct {
	Start   int     `json:"s"`
	Seconds int     `json:"n"`
	From    float64 `json:"f"`
	To      float64 `json:"t"`
}

// RideBlocks is the workout's blocks as the ride keeps them: nil when there
// is no workout to draw — a free ride, a game, a workout that asks for no
// watts anywhere — so a ride with blocks is a ride with a workout's picture.
func RideBlocks(workoutJSON string, ftp float64) []Block {
	segments, err := workout.Parse(workoutJSON)
	if err != nil {
		return nil
	}
	var out []Block
	asks := false
	for _, seg := range segments {
		if seg.Seconds <= 0 {
			continue
		}
		b := Block{Start: seg.Start, Seconds: seg.Seconds}
		switch seg.Kind {
		case "steady":
			if !seg.HrHold {
				b.From = seg.Target * ftp
				if seg.Watts > 0 {
					b.From = seg.Watts
				}
				b.To = b.From
			}
		case "warmup", "cooldown", "ramp":
			// The same ends workout.TargetAt interpolates between.
			b.From, b.To = seg.From*ftp, seg.To*ftp
		}
		asks = asks || b.From > 0 || b.To > 0
		out = append(out, b)
	}
	if !asks {
		return nil
	}
	return out
}

// RideBlocksJSON is RideBlocks as the column stores it: nil, SQL null, for a
// ride with none.
func RideBlocksJSON(workoutJSON string, ftp float64) []byte {
	blocks := RideBlocks(workoutJSON, ftp)
	if blocks == nil {
		return nil
	}
	out, err := json.Marshal(blocks)
	if err != nil {
		return nil // a slice of plain numbers marshals; nil is the picture without blocks
	}
	return out
}

// BlockTargets is each sample's target in watts, read at the workout second
// the sample was ridden at — the second Execution scored it at, so the
// picture's blocks sit under the watts they were scored against. 0 where the
// workout asked for no watts, or had ended.
func BlockTargets(blocks []Block, samples []protocol.RiderMetrics) []float64 {
	if len(blocks) == 0 {
		return nil
	}
	keyed := clockKeyed(samples)
	out := make([]float64, len(samples))
	for i, sample := range samples {
		second := i
		if keyed {
			second = sample.Clock
		}
		// The last block starting at or before this second.
		at := sort.Search(len(blocks), func(j int) bool { return blocks[j].Start > second }) - 1
		if at < 0 {
			continue
		}
		b := blocks[at]
		if second >= b.Start+b.Seconds {
			continue
		}
		out[i] = b.From + (b.To-b.From)*float64(second-b.Start)/float64(b.Seconds)
	}
	return out
}
