package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A workout the server can actually parse, with a cadence band INSIDE a
// repeat — which is where flatten would drop it and nobody would notice, the
// feature just quietly never firing on Torque Blocks.
const moodWorkout = `{"name":"Bands","steps":[
	{"type":"warmup","seconds":60,"from":0.4,"to":0.6},
	{"type":"steady","seconds":60,"target":0.85},
	{"type":"repeat","times":2,"steps":[
		{"type":"steady","seconds":60,"target":0.85,"cadenceLow":55,"cadenceHigh":65}
	]}
]}`

func startedSession(t *testing.T) *session {
	t.Helper()
	s := newSession()
	if !s.apply(protocol.Control{Action: "pick", WorkoutName: "Bands", WorkoutJSON: moodWorkout, TotalSeconds: 240}, at(0)) {
		t.Fatal("pick refused")
	}
	if !s.apply(protocol.Control{Action: "start"}, at(0)) {
		t.Fatal("start refused")
	}
	// Past the 10 s countdown, so the timeline is genuinely running.
	if got := s.state(at(11)).Phase; got != "running" {
		t.Fatalf("phase = %q, want running", got)
	}
	return s
}

// The timeline is 60 s of warmup, 60 s of steady, then two banded blocks —
// and the countdown means wall-clock 10 s is timeline second 0.
func TestMoodReadsTheBlockTheRoomIsIn(t *testing.T) {
	s := startedSession(t)

	cases := []struct {
		name    string
		wallSec int
		want    SessionMood
	}{
		{"halfway through the warmup ramp", 40, SessionMood{TargetPct: 0.5}},
		{"the steady block", 100, SessionMood{TargetPct: 0.85}},
		{"the first banded block", 130, SessionMood{TargetPct: 0.85, CadenceLow: 55, CadenceHigh: 65}},
		{"the SECOND pass of the repeat", 190, SessionMood{TargetPct: 0.85, CadenceLow: 55, CadenceHigh: 65}},
		{"past the end of the timeline", 400, SessionMood{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := s.mood(at(tc.wallSec)); got != tc.want {
				t.Errorf("mood = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// mood() must be READ-ONLY. state() promotes a finished countdown to
// "running" as a side effect of being called, and mood() is called by a
// jukebox refill — so sharing that path would mean a queue running dry
// starts the room's session. Nothing would report it; the timeline would
// simply be running when nobody pressed anything.
func TestMoodNeverStartsTheTimeline(t *testing.T) {
	s := newSession()
	s.apply(protocol.Control{Action: "pick", WorkoutName: "Bands", WorkoutJSON: moodWorkout, TotalSeconds: 240}, at(0))
	s.apply(protocol.Control{Action: "start"}, at(0))

	// Well past the countdown, but nothing has read state() yet.
	if got := s.mood(at(60)); got != (SessionMood{}) {
		t.Errorf("a countdown reported a mood: %+v", got)
	}
	if s.phase != "countdown" {
		t.Fatalf("mood advanced the phase to %q — a deck refill started the session", s.phase)
	}
	// An idle session has nothing to say either.
	if got := newSession().mood(at(0)); got != (SessionMood{}) {
		t.Errorf("an idle session reported a mood: %+v", got)
	}
}

// The hub reads the mood at the moment of the REFILL and hands it to the
// source. Without this the whole of #270 is dead wiring that type-checks.
func TestAutoplayIsToldWhatTheRoomIsRiding(t *testing.T) {
	h := New(nil, fakeAccess{}, nil)
	spy := &moodSpy{seen: make(chan SessionMood, 1)}
	h.SetPlaylistSource(spy)

	rm := h.room("mood-room")
	rm.mu.Lock()
	rm.session.apply(protocol.Control{Action: "pick", WorkoutName: "Bands", WorkoutJSON: moodWorkout, TotalSeconds: 240}, h.now())
	// Started far enough in the past that the countdown is over; the tick's
	// own state() call is what promotes it, exactly as it does in a room.
	rm.session.apply(protocol.Control{Action: "start"}, h.now().Add(-30*time.Second))
	rm.session.state(h.now())
	rm.mu.Unlock()

	h.triggerAutoplay(rm, "mood-room", false)

	select {
	case got := <-spy.seen:
		// The room is inside the warmup at this point; what matters is that a
		// real mood crossed the seam rather than the zero value by default.
		if got.TargetPct <= 0 {
			t.Errorf("autoplay was told nothing about the timeline: %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("autoplay never ran")
	}
}
