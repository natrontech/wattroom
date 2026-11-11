package stats

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// WorkoutOwnName is the name of the workout a ride rode, kept beside a
// workout_name its road set (#3055): a workout on a route — the road by
// reference, no block pinned to its metres — that asks for watts somewhere.
// That is a workout the rider picked, ridden by its clock, and its name is
// the workout's, never the road's. savedAs is the name the ride is saved
// under.
//
// Nil for everything else: a ride off any road is already saved under its
// workout's name, and a road workout (blocks pinned to metres, named by the
// route's generated name) or a free ride on a road has no name that is not
// the road's. A name that starts with the one the road gave the ride is the
// road's too, and so nil.
//
// The road is read leniently, as routes.SharedName reads it: a client saves
// the copy it was handed, the cut attached beside the reference.
func WorkoutOwnName(workoutJSON, savedAs string) *string {
	var w struct {
		Name string `json:"name"`
		Road *struct {
			StepEndM []float64 `json:"stepEndM"`
		} `json:"road"`
	}
	if json.Unmarshal([]byte(workoutJSON), &w) != nil || w.Road == nil || len(w.Road.StepEndM) > 0 {
		return nil
	}
	if RideBlocks(workoutJSON, 1) == nil {
		return nil
	}
	name := strings.TrimSpace(w.Name)
	if name == "" || utf8.RuneCountInString(name) > protocol.MaxWorkoutNameChars ||
		savedAs != "" && strings.HasPrefix(name, savedAs) {
		return nil
	}
	return &name
}
