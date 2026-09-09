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
	})
}
