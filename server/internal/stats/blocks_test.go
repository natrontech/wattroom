package stats

import (
	"slices"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// What a ride keeps of its workout for its picture (#4430): the blocks in
// watts at its FTP, and nothing for a ride that had no workout to draw.
func TestRideBlocks(t *testing.T) {
	for _, tc := range []struct {
		name    string
		workout string
		want    []Block
	}{
		{"a free ride", `{"name":"Free ride","unscored":true,"steps":[]}`, nil},
		{"the road alone", `{"name":"Free ride","steps":[{"type":"road","seconds":21600}]}`, nil},
		{"free riding alone", `{"name":"Spin","steps":[{"type":"freeride","seconds":600}]}`, nil},
		{"unreadable", `{`, nil},
		{
			"a ramp, a repeat and a held heart rate",
			`{"name":"Mix","steps":[
				{"type":"warmup","seconds":100,"from":0.5,"to":0.7},
				{"type":"repeat","times":2,"steps":[{"type":"steady","seconds":60,"target":1.0},{"type":"steady","seconds":30,"watts":120}]},
				{"type":"steady","seconds":50,"target":0.6,"hrHold":true}]}`,
			[]Block{
				{Start: 0, Seconds: 100, From: 100, To: 140},
				{Start: 100, Seconds: 60, From: 200, To: 200},
				{Start: 160, Seconds: 30, From: 120, To: 120},
				{Start: 190, Seconds: 60, From: 200, To: 200},
				{Start: 250, Seconds: 30, From: 120, To: 120},
				{Start: 280, Seconds: 50},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := RideBlocks(tc.workout, 200); !slices.Equal(got, tc.want) {
				t.Errorf("blocks = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// Each sample reads its target at the workout second it was ridden at — the
// second its score was taken at — so a paused ride's blocks stay under the
// watts that rode them.
func TestBlockTargets(t *testing.T) {
	blocks := []Block{{Start: 0, Seconds: 10, From: 100, To: 200}, {Start: 10, Seconds: 10, From: 250, To: 250}}
	byIndex := make([]protocol.RiderMetrics, 25)
	if got := BlockTargets(blocks, byIndex); got[5] != 150 || got[12] != 250 || got[22] != 0 {
		t.Errorf("by index: %v", got)
	}
	// Paused for five seconds at second 4: the clock stops and the index runs on.
	clocked := make([]protocol.RiderMetrics, 20)
	for i := range clocked {
		clocked[i].Clock = min(i, 4)
		if i >= 9 {
			clocked[i].Clock = i - 5
		}
	}
	if got := BlockTargets(blocks, clocked); got[8] != 140 || got[15] != 250 {
		t.Errorf("by clock: %v", got)
	}
	if BlockTargets(nil, byIndex) != nil {
		t.Error("targets for a ride with no blocks")
	}
}
