package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Two riders on the same w/kg used to be placed by map iteration order, so
// the 5 and the 3 points of a points race went to either at random (#824).
func TestPodiumBreaksTiesTheSameWayEveryTime(t *testing.T) {
	seen := map[string]protocol.Rider{
		"b": {ID: "b", Name: "B", WeightKg: 80},
		"a": {ID: "a", Name: "A", WeightKg: 80},
		"c": {ID: "c", Name: "C", WeightKg: 80},
	}
	samples := map[string][]int{
		"a": {400, 400, 400, 400, 400},
		"b": {400, 400, 400, 400, 400},
		"c": {500, 500, 500, 500, 500},
	}
	for round := 0; round < 20; round++ {
		got := podium(samples, seen)
		if len(got) != 3 || got[0].RiderID != "c" || got[1].RiderID != "a" || got[2].RiderID != "b" {
			t.Fatalf("round %d: podium order %v", round, got)
		}
	}
}

// sprintWorkout carries two sprint blocks of different lengths: 10 s at
// timeline second 60, 15 s at second 130. Neither is the coach button's 15 s
// by accident — #2016 is about honouring the block's own Seconds.
const sprintWorkout = `{"steps":[` +
	`{"type":"steady","seconds":60,"target":0.6},` +
	`{"type":"sprint","seconds":10},` +
	`{"type":"steady","seconds":60,"target":0.5},` +
	`{"type":"sprint","seconds":15}]}`

// runningSession is sprintWorkout mid-ride, with timeline second 0 at at(10):
// SPEC's 10 s countdown sits in front of it.
func runningSession(t *testing.T) *session {
	t.Helper()
	s := newSession()
	if !s.apply(protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: sprintWorkout}, at(0)) {
		t.Fatal("pick refused")
	}
	if !s.apply(protocol.Control{Action: "start"}, at(0)) {
		t.Fatal("start refused")
	}
	if got := s.state(at(10)); got.Phase != "running" {
		t.Fatalf("countdown did not roll into running: %+v", got)
	}
	return s
}

func runningRoom(t *testing.T) *room {
	t.Helper()
	rm := newRoom("sprints")
	rm.session = runningSession(t)
	return rm
}

// The window is the BLOCK's, not the tick's (#2016): the tick that notices a
// sprint block is up to a second late, and a window anchored on `now` would
// put every rider's countdown on a different second from the one their own
// client computed off the same timeline.
func TestSprintBlockAtAnchorsOnTheBlockNotTheTick(t *testing.T) {
	s := runningSession(t)
	cases := []struct {
		name         string
		now          int
		ok           bool
		starts, ends int
	}{
		{name: "a second before the klaxon lead", now: 66},
		{name: "the klaxon second arms the block", now: 67, ok: true, starts: 70, ends: 80},
		{name: "the block's first second", now: 70, ok: true, starts: 70, ends: 80},
		{name: "late inside the block", now: 79, ok: true, starts: 70, ends: 80},
		{name: "the second the block ends", now: 80},
		{name: "the steady block after it", now: 100},
		{name: "the klaxon of the second sprint", now: 137, ok: true, starts: 140, ends: 155},
		{name: "the second sprint runs 15 s, not 10", now: 154, ok: true, starts: 140, ends: 155},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			block, ok := s.sprintBlockAt(at(tc.now), sprintKlaxon)
			if ok != tc.ok {
				t.Fatalf("at %ds: ok=%v, want %v", tc.now, ok, tc.ok)
			}
			if !ok {
				return
			}
			if !block.startsAt.Equal(at(tc.starts)) || !block.endsAt.Equal(at(tc.ends)) {
				t.Fatalf("at %ds: window %v–%v, want %v–%v", tc.now, block.startsAt, block.endsAt, at(tc.starts), at(tc.ends))
			}
		})
	}
}

// The origin is startedAt MINUS banked, so a pause carries the block along
// with the rest of the timeline instead of leaving the window where the
// unpaused clock would have put it.
func TestSprintBlockAtFollowsAPause(t *testing.T) {
	s := runningSession(t)
	if !s.apply(protocol.Control{Action: "pause"}, at(40)) { // 30 s ridden
		t.Fatal("pause refused")
	}
	if _, ok := s.sprintBlockAt(at(200), sprintKlaxon); ok {
		t.Fatal("a paused timeline armed a sprint")
	}
	if !s.apply(protocol.Control{Action: "resume"}, at(100)) {
		t.Fatal("resume refused")
	}
	// 30 s banked, so timeline second 60 is 30 s after the resume.
	block, ok := s.sprintBlockAt(at(130), sprintKlaxon)
	if !ok || !block.startsAt.Equal(at(130)) || !block.endsAt.Equal(at(140)) {
		t.Fatalf("after a pause: %v–%v ok=%v, want %v–%v", block.startsAt, block.endsAt, ok, at(130), at(140))
	}
	// And not where the unpaused clock would have put it.
	if _, ok := s.sprintBlockAt(at(75), sprintKlaxon); ok {
		t.Fatal("the window stayed on the unpaused clock")
	}
}

// A timeline that is not running has no window — and sprintBlock must not be
// the call that starts one, like mood().
func TestSprintBlockAtNeedsARunningTimeline(t *testing.T) {
	s := newSession()
	s.apply(protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: sprintWorkout}, at(0))
	s.apply(protocol.Control{Action: "start"}, at(0))
	// Still counting down at at(5), and the sprint block's wall time has not
	// been decided yet.
	if _, ok := s.sprintBlockAt(at(5), sprintKlaxon); ok {
		t.Fatal("a countdown armed a sprint")
	}
	if s.phase != "countdown" {
		t.Fatalf("sprintBlockAt advanced the phase to %q", s.phase)
	}
}

// The latch (#2016): the tick runs once a second for the whole block, and
// re-arming would hand the podium a fresh empty sample map every second.
func TestWorkoutSprintArmsOncePerBlock(t *testing.T) {
	rm := runningRoom(t)
	for sec := 60; sec < 67; sec++ {
		rm.armWorkoutSprintLocked(at(sec))
	}
	if rm.sprint != nil {
		t.Fatal("armed before the klaxon lead")
	}
	rm.armWorkoutSprintLocked(at(67))
	armed := rm.sprint
	if armed == nil {
		t.Fatal("the klaxon second did not arm the block")
	}
	// The block's own 10 s, not the coach button's 15.
	if !armed.startsAt.Equal(at(70)) || !armed.endsAt.Equal(at(80)) {
		t.Fatalf("window %v–%v, want %v–%v", armed.startsAt, armed.endsAt, at(70), at(80))
	}
	armed.collect("jan", 900, at(72))
	for sec := 68; sec < 80; sec++ {
		rm.armWorkoutSprintLocked(at(sec))
		if rm.sprint != armed {
			t.Fatalf("re-armed the same block at %ds", sec)
		}
	}
	if got := len(rm.sprint.samples["jan"]); got != 1 {
		t.Fatalf("the samples the podium ranks were wiped: %d left", got)
	}
	// The next block is a different block, and gets its own window.
	rm.armWorkoutSprintLocked(at(137))
	if rm.sprint == armed {
		t.Fatal("the second sprint block did not arm")
	}
	if !rm.sprint.startsAt.Equal(at(140)) || !rm.sprint.endsAt.Equal(at(155)) {
		t.Fatalf("second block window %v–%v, want %v–%v", rm.sprint.startsAt, rm.sprint.endsAt, at(140), at(155))
	}
}

// Restarting the session is a new run of the same blocks, so the latch has to
// let go — otherwise the first block of every ride after the first is silent.
func TestSessionRestartRearmsTheSameBlock(t *testing.T) {
	rm := runningRoom(t)
	rm.armWorkoutSprintLocked(at(67))
	first := rm.sprint
	if first == nil {
		t.Fatal("the first run did not arm the block")
	}
	if !rm.session.apply(protocol.Control{Action: "end"}, at(90)) {
		t.Fatal("end refused")
	}
	// The same workout again, so the latch cannot be leaning on the hash
	// changing — a re-pick is how a done session becomes idle again.
	if !rm.session.apply(protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: sprintWorkout}, at(999)) {
		t.Fatal("re-pick refused")
	}
	if !rm.session.apply(protocol.Control{Action: "start"}, at(1000)) {
		t.Fatal("restart refused")
	}
	if got := rm.session.state(at(1010)); got.Phase != "running" {
		t.Fatalf("the restart did not run: %+v", got)
	}
	// Same block, new run: timeline second 60 is now at(1070).
	rm.armWorkoutSprintLocked(at(1067))
	if rm.sprint == first {
		t.Fatal("the latch outlived the session it was set in")
	}
	if !rm.sprint.startsAt.Equal(at(1070)) || !rm.sprint.endsAt.Equal(at(1080)) {
		t.Fatalf("window %v–%v, want %v–%v", rm.sprint.startsAt, rm.sprint.endsAt, at(1070), at(1080))
	}
}

// A coach who armed a sprint seconds before the block keeps their window: a
// block that replaced it would drop the samples that window was collecting.
// The latch is set anyway, so the block is not retried a second later with
// most of its window already gone.
func TestWorkoutSprintYieldsToALiveCoachSprint(t *testing.T) {
	rm := runningRoom(t)
	rm.armSprint(at(60)) // coach: 63–78
	coached := rm.sprint
	for sec := 67; sec < 80; sec++ {
		rm.armWorkoutSprintLocked(at(sec))
		if rm.sprint != coached {
			t.Fatalf("the block took the coach's live window at %ds", sec)
		}
	}
}
