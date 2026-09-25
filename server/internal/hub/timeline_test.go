package hub

import (
	"log/slog"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A session ride is kept by the timeline second (#2814). ADR-0059 made a
// join partway through routine, and the record still counted from 0: a rider
// who joined at minute ten was scored against the blocks of minute 0, fell
// short of the last block, and was dated at the session's start.

// timelineRoom is a running session of two ten-minute blocks, with the
// clock at timeline second 0 and a hand to move it.
func timelineRoom(t *testing.T) (*room, time.Time, func(second int)) {
	t.Helper()
	rm := newRoom("timeline")
	rm.session.pick("Two blocks", `{"steps":[{"type":"steady","seconds":600,"target":0.5},{"type":"steady","seconds":600,"target":1.0}]}`, 1200)
	joinRide(rm, "ana")
	t0 := time.Unix(1_000_000, 0)
	rm.session.start(t0)
	origin := t0.Add(countdownSeconds * time.Second)
	rm.session.state(origin)
	clock := origin
	rm.now = func() time.Time { return clock }
	return rm, origin, func(second int) { clock = origin.Add(time.Duration(second) * time.Second) }
}

func rider(id string) *client {
	return &client{rider: protocol.Rider{ID: id, FtpWatts: 200}}
}

func clocks(samples []protocol.RiderMetrics) []int {
	out := make([]int, len(samples))
	for i, s := range samples {
		out[i] = s.Clock
	}
	return out
}

func TestALateJoinerIsKeptOnTheTimeline(t *testing.T) {
	rm, origin, at := timelineRoom(t)
	ben := rider("ben")
	at(600)
	joinRide(rm, "ben")
	for second := 600; second < 600+MinRideSamples; second++ {
		at(second)
		rm.setMetrics(ben, protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: second})
	}
	at(600 + MinRideSamples)
	rm.session.end(rm.now())
	end := rm.closeLocked(rm.session.state(rm.now()), rm.now(), true)
	if end == nil || len(end.records) != 1 {
		t.Fatalf("the close: %+v", end)
	}
	got := end.records[0]
	if first := got.Samples[0].Clock; first != 600 {
		t.Errorf("the late joiner's first sample says second %d, want 600 — it would be scored against minute 0", first)
	}
	if last := got.Samples[len(got.Samples)-1].Clock; last != 600+MinRideSamples-1 {
		t.Errorf("the last sample says second %d, want %d", last, 600+MinRideSamples-1)
	}
	if want := origin.Add(600 * time.Second); !got.StartedAt.Equal(want) {
		t.Errorf("the ride starts at %v, want %v — ten minutes after the session", got.StartedAt, want)
	}
	if score, _ := rm.record.execution("ben"); score != 1 {
		t.Errorf("the live meter reads %v on target, want 1", score)
	}
}

// A reconnect's replay lands after the live samples that resumed before it,
// and the saver reads the record in order: the power trace, the curve and
// NormPower were built from seconds out of sequence.
func TestAReplayIsPlacedWhereItWasRidden(t *testing.T) {
	rm, _, at := timelineRoom(t)
	ana := rider("ana")
	ride := func(from, to int) {
		for second := from; second < to; second++ {
			at(second)
			rm.setMetrics(ana, protocol.RiderMetrics{Watts: 150, Cadence: 90, Seq: second + 1})
		}
	}
	ride(0, 20)
	// The socket drops for twenty seconds; live samples resume first.
	ride(40, 70)
	rm.backfill(ana, []protocol.RiderMetrics{
		{Watts: 151, Seq: 21, Clock: 20},
		{Watts: 152, Seq: 22},             // no clock: the hub cannot place it
		{Watts: 153, Seq: 23, Clock: 45},  // a second that already holds a live sample
		{Watts: 154, Seq: 24, Clock: 500}, // a second the timeline never reached
		{Watts: 155, Seq: 25, Clock: 21},
	}, slog.New(slog.DiscardHandler), nil)
	at(70)
	rm.session.end(rm.now())
	end := rm.closeLocked(rm.session.state(rm.now()), rm.now(), true)
	got := clocks(end.records[0].Samples)
	if len(got) != 52 {
		t.Fatalf("the record holds %d samples, want 50 live and 2 placed replays: %v", len(got), got)
	}
	for i := 1; i < len(got); i++ {
		if got[i] <= got[i-1] {
			t.Fatalf("the saved record is out of order at %d: %v", i, got)
		}
	}
	if got[20] != 20 || got[21] != 21 {
		t.Errorf("the replay did not land in its gap: %v", got[18:24])
	}
}

// A replay that lands after the close amends the ride the close saved
// (#1536), which the saver finds by its start. Reaching back before the
// rider's first saved second must not move that start.
func TestAnAmendmentKeepsTheStartTheCloseSaved(t *testing.T) {
	rm, origin, at := timelineRoom(t)
	ana := rider("ana")
	for second := 40; second < 40+MinRideSamples; second++ {
		at(second)
		rm.setMetrics(ana, protocol.RiderMetrics{Watts: 150, Cadence: 90, Seq: second + 1})
	}
	at(40 + MinRideSamples)
	rm.session.end(rm.now())
	end := rm.closeLocked(rm.session.state(rm.now()), rm.now(), true)
	saved := end.records[0].StartedAt
	if want := origin.Add(40 * time.Second); !saved.Equal(want) {
		t.Fatalf("the close saved a start of %v, want %v", saved, want)
	}
	saver := &amendingSaver{saverFunc: func(time.Time, []RiderRecord) {}, amended: make(chan RiderRecord, 1)}
	rm.backfill(ana, []protocol.RiderMetrics{{Watts: 140, Seq: 20, Clock: 19}, {Watts: 141, Seq: 21, Clock: 20}}, slog.New(slog.DiscardHandler), saver)
	select {
	case whole := <-saver.amended:
		if !whole.StartedAt.Equal(saved) {
			t.Errorf("the amendment looks for a ride starting %v, the close saved %v — it would find none", whole.StartedAt, saved)
		}
		if whole.Samples[0].Clock != 19 {
			t.Errorf("the amended record starts at second %d, want the replay's 19", whole.Samples[0].Clock)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no amendment")
	}
}
