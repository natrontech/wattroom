package hub

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// What a session leaves behind (ADR-0034). Presence is sampled, so these tests
// drive the sampler directly rather than a socket's join and leave — which is
// the point of sampling: the roster is the truth, whatever the sockets did.

// sawAt marks whoever is in the room at that second, the way the tick does.
func sawAt(rm *room, seconds int) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.sawLocked(pat(seconds))
}

func recapAt(rm *room, seconds, elapsed int) protocol.SessionRecap {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.recapLocked(protocol.SessionState{WorkoutName: "Openers", Elapsed: elapsed}, pat(seconds))
}

func TestRecapHoldsEveryRiderTheSessionSaw(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	jan, kim := socket("r-jan", "Jan"), socket("r-kim", "Kim")

	rm.join(jan)
	sawAt(rm, 0)
	sawAt(rm, 10)
	// Kim arrives a third of the way in and stays to the end.
	rm.join(kim)
	sawAt(rm, 20)
	sawAt(rm, 30)

	rec := recapAt(rm, 30, 30)
	if len(rec.Riders) != 2 {
		t.Fatalf("riders: %+v", rec.Riders)
	}
	// Arrival order, so the bars read down the card the way the room filled.
	if rec.Riders[0].Rider != "Jan" || rec.Riders[1].Rider != "Kim" {
		t.Fatalf("order: %+v", rec.Riders)
	}
	if rec.Riders[0].From != pat(0).UnixMilli() || rec.Riders[0].To != pat(30).UnixMilli() {
		t.Errorf("Jan's span: %d–%d", rec.Riders[0].From, rec.Riders[0].To)
	}
	if rec.Riders[1].From != pat(20).UnixMilli() {
		t.Errorf("Kim should start where she arrived, not where the session did: %d", rec.Riders[1].From)
	}
	if rec.StartedAt != pat(0).UnixMilli() || rec.EndedAt != pat(30).UnixMilli() {
		t.Errorf("session clock: %d–%d", rec.StartedAt, rec.EndedAt)
	}
}

// The clock is wall-clock, taken from the first tick that saw anybody — NOT
// state.Elapsed. A coach ending a session early zeroes elapsed, which made
// every bar the same width and the card a lie (found verifying #985).
func TestTheClockSurvivesASessionEndedEarly(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-jan", "Jan"))
	sawAt(rm, 0)
	sawAt(rm, 30)

	// Elapsed 0 is exactly what a coach-ended session reports.
	rec := recapAt(rm, 30, 0)
	if rec.StartedAt != pat(0).UnixMilli() {
		t.Errorf("the card's clock should start where the session did: %d", rec.StartedAt)
	}
	if rec.EndedAt-rec.StartedAt != 30_000 {
		t.Errorf("a 30 s session should be 30 s wide, was %d ms", rec.EndedAt-rec.StartedAt)
	}
}

func TestARiderWhoLeftEarlyStopsWhereTheyLeft(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	jan, kim := socket("r-jan", "Jan"), socket("r-kim", "Kim")
	rm.join(jan)
	rm.join(kim)
	sawAt(rm, 0)
	sawAt(rm, 10)
	rm.leave(kim)
	sawAt(rm, 20)
	sawAt(rm, 30)

	rec := recapAt(rm, 30, 30)
	if len(rec.Riders) != 2 {
		t.Fatalf("a rider who left early still belongs in the recap: %+v", rec.Riders)
	}
	if rec.Riders[1].To != pat(10).UnixMilli() {
		t.Errorf("Kim's bar should end when she did: %d", rec.Riders[1].To)
	}
	if rec.Riders[0].To != pat(30).UnixMilli() {
		t.Errorf("Jan stayed: %d", rec.Riders[0].To)
	}
}

// A socket that flaps in a garage is one rider, not a comb of bars: the recap
// says when the session first and last saw them, and nothing in between.
func TestAFlapIsStillOneBar(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	kim := socket("r-kim", "Kim")
	rm.join(kim)
	sawAt(rm, 0)
	rm.leave(kim)
	sawAt(rm, 5)
	again := socket("r-kim", "Kim")
	rm.join(again)
	sawAt(rm, 10)

	rec := recapAt(rm, 10, 10)
	if len(rec.Riders) != 1 {
		t.Fatalf("one rider, one row: %+v", rec.Riders)
	}
	if rec.Riders[0].From != pat(0).UnixMilli() || rec.Riders[0].To != pat(10).UnixMilli() {
		t.Errorf("the gap should not split the bar: %d–%d", rec.Riders[0].From, rec.Riders[0].To)
	}
}

// The same person on a desktop and a phone is one presence — the rule the
// roster already follows, inherited here for free by sampling it.
func TestTwoScreensAreOneRider(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-jan", "Jan"))
	rm.join(socket("r-jan", "Jan"))
	sawAt(rm, 0)

	if rec := recapAt(rm, 0, 0); len(rec.Riders) != 1 {
		t.Fatalf("two screens, one bar: %+v", rec.Riders)
	}
}

// A filled pip means there is a ride row to match it; everyone else was here
// without riding — the coach without a trainer, the person on the sofa.
func TestRodeMatchesTheSaversOwnThreshold(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-jan", "Jan"))
	rm.join(socket("r-kim", "Kim"))
	sawAt(rm, 0)
	for i := range MinRideSamples {
		rm.record.add("r-jan", protocol.RiderMetrics{Watts: 200, Seq: i + 1}, nil, 200, i)
	}
	rm.record.add("r-kim", protocol.RiderMetrics{Watts: 200, Seq: 1}, nil, 200, 0)

	rec := recapAt(rm, 0, 0)
	byName := map[string]bool{}
	for _, r := range rec.Riders {
		byName[r.Rider] = r.Rode
	}
	if !byName["Jan"] {
		t.Error("Jan rode a full session and should carry a filled pip")
	}
	if byName["Kim"] {
		t.Error("one sample is a misclick, not a ride")
	}
}

// A recap says presence and time. Nothing else may appear on it, and the
// wire type is where that promise is kept or lost (ADR-0034).
func TestARecapCarriesNoMetrics(t *testing.T) {
	now := pat(0)
	rm := presenceRoom(&now)
	rm.join(socket("r-jan", "Jan"))
	sawAt(rm, 0)
	for i := range MinRideSamples {
		rm.record.add("r-jan", protocol.RiderMetrics{Watts: 300, Cadence: 95, HR: 160, Seq: i + 1}, nil, 200, i)
	}

	rec := recapAt(rm, 0, 0)
	blob, err := json.Marshal(rec)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	for _, banned := range []string{"watts", "cadence", "hr", "kj", "execution", "300", "160"} {
		if strings.Contains(string(blob), banned) {
			t.Errorf("a recap must not carry %q: %s", banned, blob)
		}
	}
}
