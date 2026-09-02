package hub

import (
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// fakeXp records what the hub tells the trophy case (#467).
type fakeXp struct {
	mu      sync.Mutex
	sprints []string
	tracks  []string
	closed  []SessionClosed
}

func (f *fakeXp) SprintWon(_, riderID string, _ time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sprints = append(f.sprints, riderID)
}

func (f *fakeXp) TrackPlayed(_, riderID, ref string, _ time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tracks = append(f.tracks, riderID+":"+ref)
}

func (f *fakeXp) SessionClosed(ev SessionClosed) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = append(f.closed, ev)
}

// LiveKit's voice state reaches the room folded to rider ids — seeded when
// the room opens, replaced on every change.
func TestVoiceFeedsTheRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), nil, nil)
	h.VoiceJoined("velvet", "kim-id#a", "Kim") // before any socket opened the room
	rm := h.room("velvet")
	inVoice := func(id string) bool {
		rm.mu.Lock()
		defer rm.mu.Unlock()
		_, ok := rm.voiceNow[id]
		return ok
	}
	if !inVoice("kim-id") {
		t.Fatal("a room opened after the join does not see it")
	}
	h.VoiceJoined("velvet", "lena-id#b", "Lena")
	h.VoiceJoined("velvet", "kim-id#c", "Kim") // second tab
	if !inVoice("lena-id") || !inVoice("kim-id") {
		t.Fatal("join did not reach the room")
	}
	h.VoiceLeft("velvet", "kim-id#a")
	if !inVoice("kim-id") {
		t.Fatal("closing one tab took the rider out of voice")
	}
	h.VoiceLeft("velvet", "kim-id#c")
	if inVoice("kim-id") || !inVoice("lena-id") {
		t.Fatal("leave did not reach the room")
	}
	if ids := h.VoiceRiderIDs(); len(ids) != 1 || ids[0] != "lena-id" {
		t.Fatalf("VoiceRiderIDs = %v, want [lena-id]", ids)
	}
	h.VoiceRoomClosed("velvet")
	if inVoice("lena-id") {
		t.Fatal("room_finished left someone in voice")
	}
}

// The session hands the keeper everyone it saw: riders with their voice
// seconds, listeners who never pedalled, and who pressed start. Voice time
// counts only while the timeline runs.
func TestSessionClosedNamesRidersAndListeners(t *testing.T) {
	rm := newRoom("velvet")
	rm.xp = &fakeXp{}
	t0 := time.Unix(1000, 0)
	if !rm.control(protocol.Control{Action: "pick", WorkoutName: "w", WorkoutJSON: "{}", TotalSeconds: 60}, "coach", t0) {
		t.Fatal("pick refused")
	}
	if !rm.control(protocol.Control{Action: "start"}, "coach", t0) {
		t.Fatal("start refused")
	}
	rm.setVoice(map[string]struct{}{"coach": {}, "kim": {}})
	rm.accrueVoiceLocked("countdown", 10*time.Second)
	rm.accrueVoiceLocked("running", 40*time.Second)
	rm.accrueVoiceLocked("paused", 30*time.Second)
	samples := make([]protocol.RiderMetrics, MinRideSamples)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 200, Seq: i}
	}
	rm.backfill(protocol.Rider{ID: "kim", Name: "Kim"}, samples)
	rm.backfill(protocol.Rider{ID: "lena", Name: "Lena"}, samples[:5])

	ev := rm.closedLocked(protocol.SessionState{Phase: "done", Elapsed: 60}, t0.Add(time.Minute))
	if ev.StartedBy != "coach" || ev.Seconds != 60 || ev.Slug != "velvet" {
		t.Fatalf("event = %+v", ev)
	}
	want := map[string]SessionRider{
		"kim":   {ID: "kim", Rode: true, VoiceSeconds: 40},
		"lena":  {ID: "lena", Rode: false, VoiceSeconds: 0},
		"coach": {ID: "coach", Rode: false, VoiceSeconds: 40},
	}
	if len(ev.Riders) != len(want) {
		t.Fatalf("riders = %+v", ev.Riders)
	}
	for _, r := range ev.Riders {
		if want[r.ID] != r {
			t.Errorf("%s = %+v, want %+v", r.ID, r, want[r.ID])
		}
	}

	// A new start is a new session: the voice clock starts over.
	rm.control(protocol.Control{Action: "end"}, "coach", t0.Add(time.Minute))
	rm.control(protocol.Control{Action: "pick", WorkoutName: "w", WorkoutJSON: "{}", TotalSeconds: 60}, "kim", t0.Add(2*time.Minute))
	rm.control(protocol.Control{Action: "start"}, "kim", t0.Add(2*time.Minute))
	ev = rm.closedLocked(protocol.SessionState{Phase: "done"}, t0.Add(3*time.Minute))
	if ev.StartedBy != "kim" || len(ev.Riders) != 0 {
		t.Fatalf("restart carried the old session: %+v", ev)
	}
}

// The winner is named on the one tick that scores the sprint, and only
// when somebody else sprinted too.
func TestSprintWinnerNamedOnce(t *testing.T) {
	rm := newRoom("velvet")
	rm.seen = map[string]protocol.Rider{
		"kim":  {ID: "kim", Name: "Kim", WeightKg: 70},
		"lena": {ID: "lena", Name: "Lena", WeightKg: 70},
	}
	base := time.Unix(1000, 0)
	rm.armSprint(base)
	live := base.Add(sprintKlaxon + time.Second)
	for i := 0; i < 10; i++ {
		rm.sprint.collect("kim", 800, live)
		rm.sprint.collect("lena", 600, live)
	}
	if _, winner := rm.scoreSprintLocked(live); winner != "" {
		t.Fatalf("named %q mid-window", winner)
	}
	after := base.Add(sprintKlaxon + sprintWindow + time.Second)
	if _, winner := rm.scoreSprintLocked(after); winner != "kim" {
		t.Fatalf("winner = %q, want kim", winner)
	}
	if _, winner := rm.scoreSprintLocked(after.Add(time.Second)); winner != "" {
		t.Fatalf("named %q a second time", winner)
	}

	// Alone on the podium is not a win.
	rm.armSprint(after)
	solo := after.Add(sprintKlaxon + time.Second)
	rm.sprint.collect("kim", 800, solo)
	if _, winner := rm.scoreSprintLocked(after.Add(sprintKlaxon + sprintWindow + time.Second)); winner != "" {
		t.Fatalf("a sprint of one named %q", winner)
	}
}

// A track credits whoever queued it when it plays to the end — never when
// it is skipped — under a ref unique to that play.
func TestJukeboxCreditsTracksPlayedThrough(t *testing.T) {
	rm := newRoom("velvet")
	now := time.Unix(1000, 0)
	if played, ok := rm.jukebox(protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "one"}, "kim", "Kim", now); !ok || played != nil {
		t.Fatalf("add: ok %v played %+v", ok, played)
	}
	rm.jukebox(protocol.JukeboxCommand{Action: "add", VideoID: "abcdefghijk", Title: "two"}, "lena", "Lena", now)
	rm.jukebox(protocol.JukeboxCommand{Action: "add", VideoID: "ABCDEFGHIJK", Title: "three"}, "lena", "Lena", now)

	anchor := rm.music.state.AnchorMs
	played, ok := rm.jukebox(protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: anchor}, "lena", "Lena", now.Add(time.Minute))
	if !ok || played == nil || played.riderID != "kim" || played.ref == "" {
		t.Fatalf("ended: ok %v played %+v", ok, played)
	}
	// The echo from a second client is a no-op, not a second credit.
	if played, _ := rm.jukebox(protocol.JukeboxCommand{Action: "ended", VideoID: "dQw4w9WgXcQ", AnchorMs: anchor}, "kim", "Kim", now.Add(time.Minute)); played != nil {
		t.Fatalf("echo credited %+v", played)
	}
	// Lena's first track gets skipped: no credit; her second plays through.
	if played, _ := rm.jukebox(protocol.JukeboxCommand{Action: "skip"}, "kim", "Kim", now.Add(2*time.Minute)); played != nil {
		t.Fatalf("skip credited %+v", played)
	}
	anchor = rm.music.state.AnchorMs
	played, _ = rm.jukebox(protocol.JukeboxCommand{Action: "ended", VideoID: "ABCDEFGHIJK", AnchorMs: anchor}, "kim", "Kim", now.Add(5*time.Minute))
	if played == nil || played.riderID != "lena" {
		t.Fatalf("second play-through credited %+v", played)
	}
	if len(rm.music.owners) != 0 {
		t.Fatalf("owners leaked: %v", rm.music.owners)
	}
}
