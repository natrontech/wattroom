package hub

// Stopping the countdown is not an ending (#2605): nothing was ridden, so the
// channel goes back to idle — no "ended" line, no recap to point at, no
// coach left holding it.

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestStoppingTheCountdownClosesNothing(t *testing.T) {
	ana, ben := protocol.Rider{ID: "ana", Name: "Ana"}, protocol.Rider{ID: "ben", Name: "Ben"}
	now := pat(0)
	rm, _ := passRoom(t, &now, ana, ben) // Openers, picked and counting down
	rm.events.drain()

	stop := pat(countdownSeconds - 3)
	if code, message := rm.control(protocol.Control{Action: "end"}, ana, stop); code != "" {
		t.Fatalf("stop: %s %s", code, message)
	}
	state := rm.session.state(stop)
	if state.Phase != "idle" || state.ID != "" || state.Coach != "" {
		t.Fatalf("after the stop: %s, id %q, coach %q — want idle with no session", state.Phase, state.ID, state.Coach)
	}
	rm.mu.Lock()
	rm.sayPhaseLocked(state, stop)
	end := rm.closeLocked(state, stop, true)
	rm.mu.Unlock()
	if end != nil {
		t.Fatal("a stopped countdown was closed like a session that ran")
	}
	var lines []string
	for _, ev := range rm.events.pending {
		lines = append(lines, ev.Verb+":"+ev.Subject)
	}
	if len(lines) != 1 || lines[0] != "stopped:Openers" {
		t.Fatalf("lines: %v, want only that Openers was stopped", lines)
	}
	// The channel is anyone's again.
	if code, _ := rm.control(openers, ben, stop); code != "" {
		t.Fatalf("Ben's pick after the stop answered %q", code)
	}
}

func TestEndingOnceTheCountdownRanOutEndsTheRide(t *testing.T) {
	ana := protocol.Rider{ID: "ana", Name: "Ana"}
	now := pat(0)
	rm, _ := passRoom(t, &now, ana)
	// The clock was not read between the countdown running out and the End:
	// the timeline started all the same, so this is an ending.
	late := pat(countdownSeconds + 5)
	if code, message := rm.control(protocol.Control{Action: "end"}, ana, late); code != "" {
		t.Fatalf("end: %s %s", code, message)
	}
	if state := rm.session.state(late.Add(time.Second)); state.Phase != "done" || state.Elapsed != 5 {
		t.Fatalf("after the end: %s at %ds, want done at 5 s", state.Phase, state.Elapsed)
	}
}

// The session itself reads the clock before deciding (#2605): apply is called
// directly by the tick's own paths too, not only through control.
func TestSessionEndReadsTheClockFirst(t *testing.T) {
	s := newSession()
	s.begin("s1", "ana", "Ana")
	s.pick("Openers", `{"name":"Openers","steps":[{"type":"steady","seconds":600,"target":0.6}]}`, 600)
	t0 := pat(0)
	if !s.start(t0) {
		t.Fatal("start")
	}
	if !s.apply(protocol.Control{Action: "end"}, t0.Add((countdownSeconds+5)*time.Second)) {
		t.Fatal("end")
	}
	if s.phase != "done" || s.id != "s1" {
		t.Fatalf("after an end past the count-in: %s, id %q — want done, the ride kept", s.phase, s.id)
	}
}
