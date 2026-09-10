package hub

import (
	"context"
	"log/slog"
	"testing"
	"testing/synctest"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

type saverFunc func(startedAt time.Time, riders []RiderRecord)

func (f saverFunc) SaveSession(_ context.Context, _, _, _ string, startedAt time.Time, riders []RiderRecord) {
	f(startedAt, riders)
}

func (saverFunc) AmendRide(context.Context, string, string, string, time.Time, RiderRecord) {}

// A shutdown waits for the saver (audit 2026-09-09): the deploy replaces the
// container the moment the riding gauge drops, which is exactly when a
// session's save starts retrying, and an untracked goroutine died with it.
func TestDrainWaitsForTheSessionSave(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	rm := h.room("drain")
	release := make(chan struct{})
	saver := saverFunc(func(time.Time, []RiderRecord) { <-release })
	rm.handOff(slog.New(slog.DiscardHandler), time.Now, saver, &sessionEnd{
		records: []RiderRecord{{Rider: protocol.Rider{ID: "jan"}}},
	})
	if h.Drain(50 * time.Millisecond) {
		t.Fatal("Drain returned while the save was still running")
	}
	close(release)
	if !h.Drain(time.Second) {
		t.Fatal("Drain did not return once the save finished")
	}
}

// An empty room still keeps time (audit 2026-09-09). The last rider closing
// the tab at minute 58 of 60 used to park the session: the tick skipped
// everything below its roster check, the phase never crossed to done, and
// the record waited for the next visitor — who dated the ride as the day
// they walked in, or never came.
func TestEmptyRoomStillClosesAndSavesTheSession(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		rm := newRoom("late")
		rm.now = time.Now
		saved := make(chan []RiderRecord, 1)
		var savedAt time.Time
		saver := saverFunc(func(startedAt time.Time, riders []RiderRecord) {
			savedAt = startedAt
			saved <- riders
		})
		rm.session.pick("Openers", "{}", 60)
		rm.session.start(time.Now())
		running := time.Now().Add(countdownSeconds * time.Second)
		go rm.run(slog.New(slog.DiscardHandler), time.Now, saver)

		time.Sleep(countdownSeconds*time.Second + time.Second)
		c := sock("jan")
		rm.join(c)
		for seq := 1; seq <= 30; seq++ {
			rm.setMetrics(c, protocol.RiderMetrics{Watts: 200, Seq: seq})
			time.Sleep(time.Second)
		}
		// Closes the tab. The timeline runs out with nobody in the room.
		rm.leave(c)
		time.Sleep(2 * time.Minute)
		synctest.Wait()
		close(rm.stop)

		select {
		case riders := <-saved:
			if len(riders) != 1 || len(riders[0].Samples) != 30 {
				t.Fatalf("saved %d riders, want jan's 30 samples: %+v", len(riders), riders)
			}
			// Dated when it ran, not when the save finally fired.
			if off := savedAt.Sub(running).Abs(); off > 2*time.Second {
				t.Fatalf("ride dated %s off its start", off)
			}
		default:
			t.Fatal("the session ended with nobody in the room and was never saved")
		}
		// And the timeline's "ended" line is stamped when it ended, waiting
		// for the next visitor — not stamped the moment they walk in.
		rm.mu.Lock()
		defer rm.mu.Unlock()
		var ended *protocol.RoomEvent
		for i := range rm.events.pending {
			if rm.events.pending[i].Verb == "ended" {
				ended = &rm.events.pending[i]
			}
		}
		if ended == nil {
			t.Fatal("no ended line for the next visitor")
		}
		if off := time.UnixMilli(ended.At).Sub(running.Add(60 * time.Second)).Abs(); off > 2*time.Second {
			t.Fatalf("ended line stamped %s off the close", off)
		}
	})
}

// A rider's metrics message is a state() call too, and with someone in the
// room it is usually the one that crosses the timeline's end; the tick that
// saves the ride reads the answer after it (audit 2026-09-09). The ride used
// to be dated "now minus nothing": at its end.
func TestRideIsDatedAtItsStartWhenARiderCrossesTheEnd(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		rm := newRoom("crossing")
		rm.now = time.Now
		saved := make(chan []RiderRecord, 1)
		var savedAt time.Time
		saver := saverFunc(func(startedAt time.Time, riders []RiderRecord) {
			savedAt = startedAt
			saved <- riders
		})
		go rm.run(slog.New(slog.DiscardHandler), time.Now, saver)
		// Off the tick grid: started 300 ms after the loop's first tick, the
		// timeline runs out between two ticks, and the rider's metrics at
		// that moment are the call that crosses it.
		time.Sleep(300 * time.Millisecond)
		rm.mu.Lock()
		rm.session.pick("Openers", "{}", 60)
		rm.session.start(time.Now())
		rm.mu.Unlock()
		running := time.Now().Add(countdownSeconds * time.Second)

		time.Sleep(countdownSeconds*time.Second + time.Second)
		c := sock("jan")
		rm.join(c)
		for seq := 1; seq <= 70; seq++ {
			rm.setMetrics(c, protocol.RiderMetrics{Watts: 200, Seq: seq})
			time.Sleep(time.Second)
		}
		synctest.Wait()
		close(rm.stop)

		select {
		case <-saved:
			if off := savedAt.Sub(running).Abs(); off > 2*time.Second {
				t.Fatalf("ride dated %s off its start", off)
			}
		default:
			t.Fatal("the session ran out with a rider present and was never saved")
		}
	})
}

// The tick is what arms a workout's sprint block (#2016). docs/SPEC.md's
// glossary has always called a sprint moment "coach- or workout-armed", but
// nothing read the timeline: a `{"type":"sprint"}` block reached the room
// with no podium, no 4 Hz burst and no Sprint Snob credit. #2014 gave the
// block a client-computed window, which covers the slope flip and the
// countdown and nothing the server scores.
func TestWorkoutSprintBlockGetsAPodium(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// A 10 s sprint at timeline second 20 — not the coach button's 15 s.
		const timeline = `{"steps":[` +
			`{"type":"steady","seconds":20,"target":0.6},` +
			`{"type":"sprint","seconds":10},` +
			`{"type":"steady","seconds":30,"target":0.5}]}`
		rm := newRoom("podium")
		rm.now = time.Now
		go rm.run(slog.New(slog.DiscardHandler), time.Now, nil)
		rm.mu.Lock()
		rm.session.pick("Openers", timeline, 0)
		rm.session.start(time.Now())
		rm.mu.Unlock()
		running := time.Now().Add(countdownSeconds * time.Second)

		kim := &client{rider: protocol.Rider{ID: "kim", Name: "Kim", WeightKg: 70}}
		lena := &client{rider: protocol.Rider{ID: "lena", Name: "Lena", WeightKg: 70}}
		rm.join(kim)
		rm.join(lena)
		// Both ride the whole timeline; Kim wins the sprint.
		for seq := 1; seq <= 45; seq++ {
			rm.setMetrics(kim, protocol.RiderMetrics{Watts: 800, Seq: seq})
			rm.setMetrics(lena, protocol.RiderMetrics{Watts: 600, Seq: seq})
			time.Sleep(time.Second)
		}
		synctest.Wait()
		close(rm.stop)

		rm.mu.Lock()
		defer rm.mu.Unlock()
		if rm.sprint == nil {
			t.Fatal("the sprint block never armed")
		}
		// The block's own place and length, anchored on the timeline rather
		// than on whichever tick happened to notice it.
		if !rm.sprint.startsAt.Equal(running.Add(20*time.Second)) || !rm.sprint.endsAt.Equal(running.Add(30*time.Second)) {
			t.Fatalf("window %v–%v, want %v–%v", rm.sprint.startsAt, rm.sprint.endsAt,
				running.Add(20*time.Second), running.Add(30*time.Second))
		}
		// The 4 Hz burst rides on the same window (SPEC: "4 Hz during sprint
		// windows").
		if got := rm.tickIntervalLocked(running.Add(25 * time.Second)); got != burstTick {
			t.Fatalf("tick interval inside the block %v, want %v", got, burstTick)
		}
		if !rm.sprint.scored {
			t.Fatal("the block's window closed without a podium")
		}
		if len(rm.sprint.results) != 2 || rm.sprint.results[0].RiderID != "kim" {
			t.Fatalf("podium %+v, want Kim over Lena", rm.sprint.results)
		}
	})
}
