package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func at(sec int) time.Time { return time.Unix(1_000_000, 0).Add(time.Duration(sec) * time.Second) }

func pick(s *session) {
	s.apply(protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: "{}", TotalSeconds: 120}, at(0))
}

func TestLifecycle(t *testing.T) {
	s := newSession()
	if s.state(at(0)).Phase != "idle" {
		t.Fatalf("not idle at birth")
	}
	// Starting with no workout picked must refuse — there is nothing to run.
	if s.apply(protocol.Control{Action: "start"}, at(0)) {
		t.Fatalf("started without a workout")
	}
	pick(s)
	if !s.apply(protocol.Control{Action: "start"}, at(0)) {
		t.Fatalf("start refused")
	}

	// SPEC: 10 s countdown before the timeline runs.
	if got := s.state(at(3)); got.Phase != "countdown" || got.CountdownRemaining != 7 {
		t.Fatalf("countdown at 3s: %+v", got)
	}
	// Countdown rolls into running on its own — no message required.
	if got := s.state(at(15)); got.Phase != "running" || got.Elapsed != 5 {
		t.Fatalf("running at 15s: %+v", got)
	}
}

func TestPauseBanksTime(t *testing.T) {
	s := newSession()
	pick(s)
	s.apply(protocol.Control{Action: "start"}, at(0))
	s.state(at(10)) // roll countdown into running at t=10

	if !s.apply(protocol.Control{Action: "pause"}, at(40)) {
		t.Fatalf("pause refused")
	}
	// Paused for a minute: elapsed holds at 30.
	if got := s.state(at(100)); got.Phase != "paused" || got.Elapsed != 30 {
		t.Fatalf("paused state: %+v", got)
	}
	s.apply(protocol.Control{Action: "resume"}, at(100))
	if got := s.state(at(110)); got.Phase != "running" || got.Elapsed != 40 {
		t.Fatalf("resumed state: %+v", got)
	}
}

func TestTimelineEndsItself(t *testing.T) {
	// SPEC lifecycle: the session closes when the timeline ends — a coach
	// pressing a button is the exception, not the mechanism.
	s := newSession()
	pick(s)
	s.apply(protocol.Control{Action: "start"}, at(0))
	if got := s.state(at(10 + 300)); got.Phase != "done" || got.Elapsed != 120 {
		t.Fatalf("did not end itself: %+v", got)
	}
	// A done session accepts a new pick and can run again.
	pick(s)
	if !s.apply(protocol.Control{Action: "start"}, at(500)) {
		t.Fatalf("could not restart after done")
	}
}

func TestNoMidSessionHijack(t *testing.T) {
	s := newSession()
	pick(s)
	s.apply(protocol.Control{Action: "start"}, at(0))
	s.state(at(20))
	// Picking mid-ride would yank everyone's targets — refused.
	if s.apply(protocol.Control{Action: "pick", WorkoutName: "x", WorkoutJSON: "{}", TotalSeconds: 60}, at(20)) {
		t.Fatalf("mid-session pick accepted")
	}
	if !s.apply(protocol.Control{Action: "end"}, at(30)) {
		t.Fatalf("end refused")
	}
	if got := s.state(at(31)); got.Phase != "done" {
		t.Fatalf("not done after end: %+v", got)
	}
}

// The close is read more than once (audit 2026-09-09): a rider's metrics or
// a presence poll can be the state() call that crosses the timeline's end,
// and the tick that saves the ride reads the answer AFTER it. Elapsed used
// to be right on the crossing call only — every later read said 0, and the
// saver dated the ride "now minus nothing": at its end.
func TestElapsedSurvivesTheClose(t *testing.T) {
	t.Run("the timeline running out", func(t *testing.T) {
		s := newSession()
		pick(s)
		s.apply(protocol.Control{Action: "start"}, at(0))
		if got := s.state(at(10 + 120)); got.Phase != "done" || got.Elapsed != 120 {
			t.Fatalf("crossing call: %+v", got)
		}
		if got := s.state(at(10 + 121)); got.Phase != "done" || got.Elapsed != 120 {
			t.Fatalf("the read after the crossing: %+v", got)
		}
	})
	t.Run("the coach ending it early", func(t *testing.T) {
		s := newSession()
		pick(s)
		s.apply(protocol.Control{Action: "start"}, at(0))
		s.state(at(10))
		if !s.apply(protocol.Control{Action: "end"}, at(40)) {
			t.Fatalf("end refused")
		}
		if got := s.state(at(41)); got.Phase != "done" || got.Elapsed != 30 {
			t.Fatalf("ended at 30 s in: %+v", got)
		}
	})
	t.Run("ended while paused", func(t *testing.T) {
		s := newSession()
		pick(s)
		s.apply(protocol.Control{Action: "start"}, at(0))
		s.state(at(10))
		s.apply(protocol.Control{Action: "pause"}, at(40))
		s.apply(protocol.Control{Action: "end"}, at(100))
		if got := s.state(at(101)); got.Elapsed != 30 {
			t.Fatalf("a pause is not riding: %+v", got)
		}
	})
}
