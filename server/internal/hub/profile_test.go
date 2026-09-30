package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A rider who fixes their FTP mid-session rides targets from the new one;
// the hub has to score them against it too, or their execution says they
// never held a watt of it.
func TestAProfileSaveReachesTheScore(t *testing.T) {
	rm := newChannelState("test")
	t0 := time.Unix(1000, 0)
	jan := &client{rider: protocol.Rider{ID: "jan", Name: "jan", FtpWatts: 200}}
	rm.clients[jan] = struct{}{}
	if !ran(rm.control(protocol.Control{Action: "pick", WorkoutName: "x", WorkoutJSON: `{"steps":[{"type":"steady","seconds":600,"target":0.8}]}`, TotalSeconds: 600}, as("jan"), t0)) {
		t.Fatal("pick refused")
	}
	if !ran(rm.control(protocol.Control{Action: "start"}, as("jan"), t0)) {
		t.Fatal("start refused")
	}
	rm.now = func() time.Time { return t0.Add(30 * time.Second) }
	rm.session.state(rm.now())

	rm.setProfile(protocol.Rider{
		ID: "jan", Name: "Jan", FtpWatts: 250, WeightKg: 70,
		FtpSource: "manual", WeightSource: "manual", WeightChangedAt: 5, WeightConfirmedAt: 5,
	})
	// 80 % of the new 250 W is 200 W; of the old 200 W it was 160 W, and
	// 200 W sits 40 W outside that band.
	rm.setMetrics(jan, protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: 1})

	if score, scored := rm.record.execution("jan"); !scored || score != 1 {
		t.Fatalf("execution = %v (scored %v), want 1 against the new FTP", score, scored)
	}
	if got := rm.seen["jan"]; got.Name != "Jan" || got.WeightKg != 70 {
		t.Fatalf("the session's copy kept the old profile: %+v", got)
	}
	// A weight changed mid-session is a fresh one at a race's flag (#3169):
	// the roster carries the new date, not the one the socket opened with.
	for _, got := range []protocol.Rider{jan.rider, rm.seen["jan"]} {
		if got.WeightChangedAt != 5 || got.WeightConfirmedAt != 5 || got.WeightSource != "manual" {
			t.Fatalf("the weight's provenance stayed behind: %+v", got)
		}
	}
}
