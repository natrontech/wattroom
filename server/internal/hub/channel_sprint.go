package hub

// A sprint moment on the tick: a workout's own sprint block armed as its
// window opens, and the window scored as it closes. Split from tick.go (#3357).

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// armedSprintKey names one sprint block of one run of the timeline. Both
// halves matter: the block's second tells two sprints of the same workout
// apart, and the run number lets go of the latch when the session is
// restarted or a new workout picked (session.run). Plain ints, so the latch
// compares by value and never by an instant derived twice.
//
// The zero value cannot collide with a real block: session.run is 0 until
// start() bumps it, and only a running timeline has a block at all.
type armedSprintKey struct {
	run    int
	second int
}

// armWorkoutSprintLocked gives a workout's `{"type":"sprint"}` block the
// server-side sprint moment a coach's button gets (#2016): the podium, the
// 4 Hz tick burst and Sprint Snob XP. docs/SPEC.md's glossary has always
// said a sprint moment is "coach- or workout-armed"; only the coach half
// existed. #2014 gave the block a client-computed window, which covers the
// slope flip and the countdown but nothing the server scores.
//
// Armed once per block, and never over a sprint that is still running: a
// coach who armed one seconds before the block keeps their window and its
// podium, rather than having the samples wiped out from under it. The latch
// is set either way, so the declined block is not retried a second later
// with most of its window already gone.
//
// The window's length is the coach's to choose only as far as the workout
// boundary allows: workout.Validate bounds every step, so the 4 Hz burst
// this puts the room on lasts as long as the block the room's own coach
// picked and no longer.
//
// Caller holds rm.mu.
func (rm *channelState) armWorkoutSprintLocked(now time.Time) {
	block, ok := rm.session.sprintBlockAt(now, sprintKlaxon)
	if !ok {
		return
	}
	key := armedSprintKey{run: rm.session.run, second: block.second}
	if rm.armedBlock == key {
		return
	}
	rm.armedBlock = key
	if sp := rm.sprint; sp != nil && now.Before(sp.endsAt) {
		return
	}
	rm.armSprintWindow(block.startsAt, block.endsAt)
}

// scoreSprintLocked renders the sprint for the tick and names the winner on
// the one tick that scores it (#467). Caller holds rm.mu.
func (rm *channelState) scoreSprintLocked(now time.Time) (*protocol.SprintState, string) {
	scoredBefore := rm.sprint != nil && rm.sprint.scored
	// Scored against who is still here (#1577): leave at second six of
	// fifteen and the podium — and its XP — used to be yours anyway.
	roster := rm.seen
	if rm.sprint != nil && !scoredBefore {
		roster = make(map[string]protocol.Rider, len(rm.seen))
		for id, rider := range rm.seen {
			if rm.presentLocked(id) {
				roster[id] = rider
			}
		}
	}
	state := rm.sprint.state(now, roster)
	if scoredBefore || rm.sprint == nil || !rm.sprint.scored || len(rm.sprint.results) < minSprintField {
		return state, ""
	}
	return state, rm.sprint.results[0].RiderID
}
