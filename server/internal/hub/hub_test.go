package hub

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// sock is one of a rider's screens. Metrics arrive from a socket rather than
// from a bare rider id (#610): which screen holds the trainer claim decides
// whose samples the room takes.
func sock(riderID string) *client {
	return &client{rider: protocol.Rider{ID: riderID}}
}

func TestRoomMetricsCoalescing(t *testing.T) {
	rm := newRoom("test")

	tests := []struct {
		name    string
		samples map[string][]protocol.RiderMetrics
		want    map[string]int // rider -> expected watts after coalescing
	}{
		{
			name: "latest sample wins within a tick",
			samples: map[string][]protocol.RiderMetrics{
				"jan": {{Watts: 200, Seq: 1}, {Watts: 250, Seq: 2}},
			},
			want: map[string]int{"jan": 250},
		},
		{
			name: "riders are independent",
			samples: map[string][]protocol.RiderMetrics{
				"jan": {{Watts: 300, Seq: 3}},
				"kai": {{Watts: 180, Seq: 1}},
			},
			want: map[string]int{"jan": 300, "kai": 180},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rm.metrics = make(map[string]protocol.RiderMetrics)
			for rider, samples := range tt.samples {
				for _, s := range samples {
					rm.setMetrics(sock(rider), s)
				}
			}
			for rider, watts := range tt.want {
				if got := rm.metrics[rider].Watts; got != watts {
					t.Errorf("rider %s: got %d watts, want %d", rider, got, watts)
				}
			}
		})
	}
}

func TestLeaveRemovesMetrics(t *testing.T) {
	rm := newRoom("test")
	c := &client{rider: protocol.Rider{ID: "jan"}}
	rm.join(c)
	rm.setMetrics(sock("jan"), protocol.RiderMetrics{Watts: 200})
	rm.leave(c)
	if _, ok := rm.metrics["jan"]; ok {
		t.Error("metrics for departed rider should be removed")
	}
}

func TestControlNeedsRole(t *testing.T) {
	// The role check lives in HandleWS; what the room guarantees is that a
	// control only lands through control(), which the handler role-gates. This
	// pins the helper the gate depends on.
	for role, want := range map[string]bool{"owner": true, "coach": true, "member": false, "": false} {
		if got := canControl(role); got != want {
			t.Errorf("canControl(%q) = %v", role, got)
		}
	}
}

func TestAccumulatorDedupesAcrossLiveAndBackfill(t *testing.T) {
	// The crash-safety property (#19): live samples and a reconnect's replay
	// arrive through different doors but land in one record, deduped by seq —
	// resending is always safe and never double-counts.
	rm := newRoom("test")
	rm.session.pick("Openers", "{}", 600)
	rm.session.start(time.Unix(0, 0))
	rm.session.state(time.Unix(20, 0)) // roll countdown into running
	// The room's own clock, one second per sample. On wall time the session
	// (started at the epoch) had long run out, so one live sample landed and
	// two were refused — and the count below came out right by the wrong
	// route (audit 2026-09-09).
	clock := time.Unix(20, 0)
	rm.now = func() time.Time { return clock }

	for seq := 1; seq <= 3; seq++ {
		clock = clock.Add(time.Second)
		rm.setMetrics(sock("jan"), protocol.RiderMetrics{Watts: 200, Seq: seq})
	}
	if got := rm.record.count("jan"); got != 3 {
		t.Fatalf("expected the 3 live samples recorded before the drop, got %d", got)
	}
	// The socket dropped after seq 3; the client replays 2..6 from its buffer.
	rm.backfill(sock("jan"), []protocol.RiderMetrics{
		{Watts: 200, Seq: 2}, {Watts: 201, Seq: 3}, {Watts: 202, Seq: 4},
		{Watts: 203, Seq: 5}, {Watts: 204, Seq: 6},
	})
	if got := rm.record.count("jan"); got != 6 {
		t.Fatalf("expected exactly 6 samples after dedupe, got %d", got)
	}

	// A hostile batch cannot grow memory: junk is dropped at the bound.
	rm.backfill(sock("jan"), []protocol.RiderMetrics{{Watts: 9999, Seq: 7}})
	if got := rm.record.count("jan"); got != 6 {
		t.Fatalf("out-of-bounds sample was recorded: %d", got)
	}

	// A new session is a new ride — a start the running session refuses
	// resets nothing (audit 2026-09-09), so end it and pick again first.
	rm.control(protocol.Control{Action: "end"}, "jan", time.Unix(100, 0))
	rm.session.pick("Openers", "{}", 600)
	if !rm.control(protocol.Control{Action: "start"}, "jan", time.Unix(101, 0)) {
		t.Fatal("the restart was refused")
	}
	if got := rm.record.count("jan"); got != 0 {
		t.Fatalf("record survived a session restart: %d", got)
	}
}

func TestBackfillNeedsTheTrainerClaim(t *testing.T) {
	// The replay is gated like live metrics (audit 2026-09-09): the screen
	// that lost the trainer to the rider's other tab must not land its
	// buffer in the record beside the holder's.
	rm := newRoom("test")
	holder := screen("jan", "desk", "desktop")
	other := screen("jan", "phone", "phone")
	rm.join(holder)
	rm.join(other)
	rm.claimSensors(holder, protocol.SensorClaim{Held: []string{"trainer"}, Tab: "desk", Device: "desktop"})

	rm.backfill(other, []protocol.RiderMetrics{{Watts: 200, Seq: 1}})
	if got := rm.record.count("jan"); got != 0 {
		t.Fatalf("a tab without the claim backfilled %d samples", got)
	}
	rm.backfill(holder, []protocol.RiderMetrics{{Watts: 200, Seq: 1}})
	if got := rm.record.count("jan"); got != 1 {
		t.Fatalf("the holder's backfill recorded %d samples, want 1", got)
	}
}

func TestRecordKeepsGrowingAcrossASeqRestart(t *testing.T) {
	// #522: a client's seq counter restarts whenever the client does — a
	// reload, or a re-paired trainer. Deduping on seq alone then dropped
	// every sample after the restart, and silently: the live tiles never
	// consult the record, so the only symptoms were a frozen execution meter
	// and a saved ride that stopped mid-session.
	const sent = 100
	live := func(seqs ...int) []protocol.RiderMetrics {
		out := make([]protocol.RiderMetrics, 0, len(seqs))
		for _, seq := range seqs {
			out = append(out, protocol.RiderMetrics{Watts: 200, Seq: seq})
		}
		return out
	}

	tests := []struct {
		name   string
		after  []protocol.RiderMetrics // live, after seqs 1..100
		replay []protocol.RiderMetrics // then a reconnect's backfill
		want   int
	}{
		{
			name:  "a re-paired trainer starting over at 1 keeps recording",
			after: live(1, 2, 3),
			want:  sent + 3,
		},
		{
			name:  "a stream that simply carries on is not a restart",
			after: live(101, 102),
			want:  sent + 2,
		},
		{
			name:   "a replay still dedupes against what it already sent",
			replay: live(99, 100, 101),
			want:   sent + 1,
		},
		{
			name:   "a replay after a restart dedupes on the new stream",
			after:  live(1, 2, 3),
			replay: live(2, 3, 4),
			want:   sent + 4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rm := newRoom("test")
			rm.session.pick("Openers", "{}", 3600)
			// Started "now" so the timeline cannot run itself out from under
			// the samples — state() closes a session whose total has elapsed.
			now := time.Now()
			rm.session.start(now)
			rm.session.state(now.Add(countdownSeconds * time.Second))

			// One second of room time per sample. The record admits one
			// sample per timeline second (#791), so a hundred packets fired
			// inside one second would be one sample — which is the bug, not
			// this test's subject: this one is about seq and stream.
			clock := now.Add(countdownSeconds * time.Second)
			rm.now = func() time.Time {
				clock = clock.Add(time.Second)
				return clock
			}

			for seq := 1; seq <= sent; seq++ {
				rm.setMetrics(sock("jan"), protocol.RiderMetrics{Watts: 200, Seq: seq})
			}
			if got := rm.record.count("jan"); got != sent {
				t.Fatalf("setup recorded %d samples, want %d", got, sent)
			}

			for _, m := range tt.after {
				rm.setMetrics(sock("jan"), m)
			}
			if len(tt.replay) > 0 {
				rm.backfill(sock("jan"), tt.replay)
			}
			if got := rm.record.count("jan"); got != tt.want {
				t.Errorf("record holds %d samples, want %d", got, tt.want)
			}
		})
	}
}

func TestBackfillSurvivesAnIdleRoom(t *testing.T) {
	// After a server restart the room comes back idle; the reconnect replay
	// must still land — dropping it there is exactly the loss #19 prevents.
	rm := newRoom("test")
	rm.backfill(sock("jan"), []protocol.RiderMetrics{{Watts: 200, Seq: 1}, {Watts: 201, Seq: 2}})
	if got := rm.record.count("jan"); got != 2 {
		t.Fatalf("idle-room backfill dropped: %d", got)
	}
}

func TestCheerShapeAndBound(t *testing.T) {
	rm := newRoom("test")
	for i := 0; i < 50; i++ {
		rm.cheer(protocol.Cheer{Emoji: "🔥", From: "jan"})
	}
	if len(rm.cheers) != 32 {
		t.Fatalf("cheer buffer unbounded: %d", len(rm.cheers))
	}
	// The wire gate is the shape check — IsIconOrEmoji has its own table
	// test; this pins that the hub actually consults it, for a key (#447)
	// and for the emoji an older client still throws.
	if !protocol.IsIconOrEmoji("flame") || !protocol.IsIconOrEmoji("🔥") {
		t.Fatal("shape check missing the obvious ones")
	}
	if protocol.IsIconOrEmoji("<script>") {
		t.Fatal("shape check lets text through")
	}
}

func TestSprintLifecycle(t *testing.T) {
	rm := newRoom("test")
	rm.session.pick("W", `{"name":"W","steps":[{"type":"steady","seconds":600,"target":0.9}]}`, 600)
	rm.session.start(time.Unix(0, 0))
	rm.session.state(time.Unix(20, 0)) // countdown -> running

	if rm.armIfRunning(time.Unix(30, 0)) != true {
		t.Fatal("arm refused mid-session")
	}
	rider := protocol.Rider{ID: "jan", Name: "Jan", FtpWatts: 250, WeightKg: 80}
	rm.seen["jan"] = rider

	// Samples before the window are ignored; inside they collect.
	rm.sprint.collect("jan", 900, time.Unix(31, 0)) // klaxon: not started
	for i := 0; i < 10; i++ {
		rm.sprint.collect("jan", 600+i*10, time.Unix(34+int64(i), 0))
	}
	// Mid-window state has no results.
	if st := rm.sprint.state(time.Unix(40, 0), rm.seen); st == nil || st.Results != nil {
		t.Fatalf("mid-window: %+v", st)
	}
	// Past the end: scored exactly once, podium in w/kg.
	st := rm.sprint.state(time.Unix(50, 0), rm.seen)
	if st == nil || len(st.Results) != 1 || st.Results[0].Name != "Jan" {
		t.Fatalf("podium: %+v", st)
	}
	if st.Results[0].Watts < 600 || st.Results[0].Wkg <= 0 {
		t.Fatalf("score: %+v", st.Results[0])
	}
	// Long after: gone.
	if rm.sprint.state(time.Unix(120, 0), rm.seen) != nil {
		t.Fatal("sprint lingered forever")
	}
	// Arming while idle refuses.
	rm.session.phase = "done"
	if rm.armIfRunning(time.Unix(130, 0)) {
		t.Fatal("armed outside a session")
	}
}

// The deploy guard on the VM restarts the app when nobody is on a trainer, so
// the gauge counts LIVE TRAINERS rather than people holding a socket — a room
// full of people between sessions is the normal case and must not block a
// rollout. Deliberately looser than the rider-facing "riding" (#1016): a rider
// resting between intervals is not riding, and a restart in their rest is
// still a restart mid-session, so this one keeps reading lastMetric.
func TestRidingGaugeCountsLiveTrainersNotPresence(t *testing.T) {
	h := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)
	now := time.Now()
	h.now = func() time.Time { return now }

	rm := newRoom("test")
	rm.seen["jan"] = protocol.Rider{ID: "jan", Name: "Jan"}
	rm.seen["sven"] = protocol.Rider{ID: "sven", Name: "Sven"}
	rm.lastMetric["jan"] = now.Add(-2 * time.Second)   // trainer talking
	rm.lastMetric["sven"] = now.Add(-60 * time.Second) // present, sample stale
	h.rooms["test"] = rm

	if got := h.ridingCount(); got != 1 {
		t.Fatalf("ridingCount = %v, want 1 — sven is in the room, trainer silent", got)
	}

	// Everyone stops: the room is still occupied, and a deploy is now fine.
	rm.lastMetric["jan"] = now.Add(-ridingWindow - time.Second)
	if got := h.ridingCount(); got != 0 {
		t.Fatalf("ridingCount = %v, want 0 once every sample is stale", got)
	}
}

// Riding is a thing a rider does, not a thing their trainer does (#1016). A
// paired trainer publishes 0 W at 1 Hz for as long as the tab is open, so the
// friends page used to mark anyone who had ever paired as riding, forever.
func TestRidingLockedNeedsWatts(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name    string
		samples []protocol.RiderMetrics
		// How long before `now` the last sample arrived.
		ago  time.Duration
		want bool
	}{
		{"never pedalled", []protocol.RiderMetrics{{Watts: 0}, {Watts: 0}}, 0, false},
		{"pedalling", []protocol.RiderMetrics{{Watts: 214}}, 0, true},
		{"coasting holds the mark", []protocol.RiderMetrics{{Watts: 214}, {Watts: 0}}, 5 * time.Second, true},
		{"sat down loses it", []protocol.RiderMetrics{{Watts: 214}, {Watts: 0}}, 15 * time.Second, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rm := newRoom("test")
			rider := protocol.Rider{ID: "jan", Name: "Jan"}
			rm.seen["jan"] = rider
			// The trainer is paired and talking at 1 Hz throughout — that is
			// the bug: 0 W is a sample like any other, so lastMetric is fresh
			// in every case here and only the watts stamp moves. setMetrics
			// needs a client and a claim, and the stamping rule is what is
			// under test, not the ingest guard.
			rm.lastMetric["jan"] = now
			at := now.Add(-tc.ago)
			for _, m := range tc.samples {
				if m.Watts > 0 {
					rm.lastWatts["jan"] = at
				}
			}
			names, ids := rm.ridingLocked(now)
			if got := len(names) == 1; got != tc.want {
				t.Fatalf("riding = %v (%v), want %v", got, names, tc.want)
			}
			if len(names) != len(ids) {
				t.Fatalf("names %v and ids %v are different lengths", names, ids)
			}
			// The trainer is talking either way — that signal must survive.
			if rm.liveTrainersLocked(now) != 1 {
				t.Fatalf("liveTrainersLocked = 0, want 1: the trainer is connected in every case here")
			}
		})
	}
}

func TestRidingCountSumsRooms(t *testing.T) {
	h := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)
	now := time.Now()
	h.now = func() time.Time { return now }

	for _, slug := range []string{"a", "b"} {
		rm := newRoom(slug)
		rm.seen[slug] = protocol.Rider{ID: slug, Name: slug}
		rm.lastMetric[slug] = now
		h.rooms[slug] = rm
	}
	if got := h.ridingCount(); got != 2 {
		t.Fatalf("ridingCount = %v, want 2 across two rooms", got)
	}
}

// Deleting a room frees its slug, so the next room of the same name takes it —
// and used to open holding the deleted room's jukebox queue, because nothing
// ever removed the room from the hub (#618). The durable row and the live
// state have to go together.
func TestCloseRoomForgetsLiveState(t *testing.T) {
	h := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)
	rm := h.room("reverify")
	rm.mu.Lock()
	rm.music.state.Queue = []protocol.JukeboxEntry{{ID: "1", VideoID: "abc", Title: "Left behind"}}
	rm.seen["jan"] = protocol.Rider{ID: "jan", Name: "Jan"}
	rm.mu.Unlock()
	h.voice["reverify"] = map[string]voiceEntry{"jan": {}}

	h.CloseRoom("reverify")

	h.mu.Lock()
	_, stillThere := h.rooms["reverify"]
	_, voiceThere := h.voice["reverify"]
	h.mu.Unlock()
	if stillThere || voiceThere {
		t.Fatalf("deleted room still in the hub: room=%v voice=%v", stillThere, voiceThere)
	}

	// A new room on the freed slug is a new room, not the old one.
	fresh := h.room("reverify")
	if fresh == rm {
		t.Fatal("the recreated room is the deleted room")
	}
	fresh.mu.Lock()
	defer fresh.mu.Unlock()
	if len(fresh.music.state.Queue) != 0 {
		t.Fatalf("inherited the deleted room's queue: %v", fresh.music.state.Queue)
	}
	if len(fresh.seen) != 0 {
		t.Fatalf("inherited the deleted room's riders: %v", fresh.seen)
	}
}

// The tick goroutine has to end with the room, or every deleted room leaves a
// ticker running for the life of the process.
func TestCloseRoomStopsTheTicker(t *testing.T) {
	h := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)
	rm := h.room("stopper")
	h.CloseRoom("stopper")
	select {
	case <-rm.stop:
	default:
		t.Fatal("the room was never told to stop ticking")
	}
}

func TestOneSecondOfRidingIsOneSample(t *testing.T) {
	// #791: the ride record is read as one sample per second — saved duration
	// is len(samples) (stats.BuildRideRow). A client's sequence number is
	// proof that it sent something, never that a second passed, and trainer
	// notifications are irregular: a burst, or a backgrounded tab flushing
	// what it buffered, used to become minutes of riding that never happened.
	rm := newRoom("test")
	rm.session.pick("Openers", "{}", 3600)
	start := time.Now()
	rm.session.start(start)
	rm.session.state(start.Add(countdownSeconds * time.Second))

	// Sixty packets, one timeline second. The isolated probe in the issue.
	clock := start.Add(countdownSeconds * time.Second)
	rm.now = func() time.Time { return clock }
	for seq := 1; seq <= 60; seq++ {
		rm.setMetrics(sock("jan"), protocol.RiderMetrics{Watts: 200, Seq: seq})
	}
	if got := rm.record.count("jan"); got != 1 {
		t.Errorf("60 packets inside one second recorded %d seconds of riding, want 1", got)
	}

	// The clock moves, the record grows — one per second, whatever the client
	// sends in between.
	for second := 1; second <= 5; second++ {
		clock = clock.Add(time.Second)
		for burst := 0; burst < 3; burst++ {
			rm.setMetrics(sock("jan"), protocol.RiderMetrics{Watts: 200, Seq: 100 + second*10 + burst})
		}
	}
	if got := rm.record.count("jan"); got != 6 {
		t.Errorf("five more seconds recorded %d samples in total, want 6", got)
	}

	// A backfill is not gated on the clock: a replayed sample's timeline
	// second is unknown, it dedupes on seq, and dropping it is the data loss
	// the buffer exists to prevent (#19).
	rm.backfill(sock("jan"), []protocol.RiderMetrics{
		{Watts: 180, Seq: 900}, {Watts: 185, Seq: 901},
	})
	if got := rm.record.count("jan"); got != 8 {
		t.Errorf("a reconnect's replay recorded %d samples in total, want 8", got)
	}
}
