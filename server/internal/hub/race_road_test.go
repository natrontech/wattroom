package hub

import (
	"context"
	"log/slog"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// raceOnCut is raceOn on a cut that begins 420 m into the stored road — one
// height step past the hidden end, as road.Cut lands it — and saving.
func raceOnCut(t *testing.T, riders ...protocol.Rider) *raceRoom {
	t.Helper()
	r := raceOn(t, 600, riders...)
	r.rm.session.route.CutFromM = 420
	r.saving = true
	return r
}

// stored is each sample's metre as a ride keeps it, checked to start on the
// cut's first metre, never to go back, and to stand on the stored road
// between the cut's start and the line.
func stored(t *testing.T, rec RiderRecord) []float64 {
	t.Helper()
	if len(rec.Samples) == 0 || rec.Samples[0].M != 420 {
		t.Fatalf("%s's ride does not start where the race did: %+v", rec.Rider.ID, rec.Samples[:min(1, len(rec.Samples))])
	}
	out := make([]float64, len(rec.Samples))
	last := 0.0
	for i, s := range rec.Samples {
		if s.M < 420 || s.M < last || s.M > 1020+1e-6 {
			t.Fatalf("%s's second %d (clock %d) stands at %.1f m after %.1f m", rec.Rider.ID, i, s.Clock, s.M, last)
		}
		out[i], last = s.M, s.M
	}
	return out
}

func recordOf(t *testing.T, end *sessionEnd, id string) RiderRecord {
	t.Helper()
	if end == nil {
		t.Fatal("nothing was handed to the saver")
	}
	for _, rec := range end.records {
		if rec.Rider.ID == id {
			return rec
		}
	}
	t.Fatalf("no record for %s in %+v", id, end.records)
	return RiderRecord{}
}

// #3722: a race hands the saver each racer's ride along its road — the
// session's route, where on the stored road they started, how far they rode,
// whether WattRoom held their watts — and every second of their record stands
// where the race had them at its end, in the stored road's metres, never
// going back, the last one on the line.
func TestARaceHandsTheSaverEachRidersRoad(t *testing.T) {
	r := raceOnCut(t, racer("ana", 70), racer("ben", 70))
	r.rm.setDrive(r.clients["ben"], protocol.Drive{ErgByRoad: true})
	r.ride(10+protocol.RaceNeutralSeconds+120, watts(map[string]int{"ana": 250, "ben": 250}))
	for _, id := range []string{"ana", "ben"} {
		rec := recordOf(t, r.ended, id)
		road := rec.Road
		if road == nil || road.RouteID != "home" || road.RoadHash != "h-home" || road.FromM != 420 ||
			math.Abs(road.DistanceM-600) > 1e-6 || road.ErgByRoad != (id == "ben") {
			t.Fatalf("%s's road: %+v", id, road)
		}
		if m := stored(t, rec); math.Abs(m[len(m)-1]-1020) > 1e-6 {
			t.Errorf("%s's record ends at %.1f m, want the line at 1020 m", id, m[len(m)-1])
		}
	}
}

// A rider silent for a few seconds, back live, and then replaying the gap
// (#3722): the replayed seconds stand where the race coasted them, by their
// own second, and the record never jumps ahead of itself or goes back.
func TestAReplayedGapStandsWhereTheRaceHadIt(t *testing.T) {
	r := raceOnCut(t, racer("ana", 70), racer("ben", 70))
	r.ride(10+protocol.RaceNeutralSeconds+20, watts(map[string]int{"ana": 250, "ben": 250}))
	gapFrom := r.rm.session.state(r.now).Elapsed
	r.ride(5, watts(map[string]int{"ana": 250}))
	r.ride(3, watts(map[string]int{"ana": 250, "ben": 250}))
	replay := make([]protocol.RiderMetrics, 5)
	for i := range replay {
		replay[i] = protocol.RiderMetrics{Watts: 250, Seq: 10_000 + i, Clock: gapFrom + i}
	}
	r.rm.backfill(r.clients["ben"], replay, slog.New(slog.DiscardHandler), nil)
	r.ride(120, watts(map[string]int{"ana": 250, "ben": 250}))
	stored(t, recordOf(t, r.ended, "ben"))
}

// A second End in the same second as the first (#3722): the card clears, and
// the close still hands every racer their road.
func TestASecondEndStillSavesTheRoads(t *testing.T) {
	ana := racer("ana", 70)
	r := raceOnCut(t, ana, racer("ben", 70))
	r.ride(10+protocol.RaceNeutralSeconds+20, watts(map[string]int{"ana": 250, "ben": 250}))
	r.rm.endGame(r.now)
	r.rm.endGame(r.now)
	r.ride(1, watts(nil))
	for _, id := range []string{"ana", "ben"} {
		if rec := recordOf(t, r.ended, id); rec.Road == nil {
			t.Errorf("%s was saved with no road after a second End", id)
		}
	}
}

// A replay that arrives after the card has gone (#3722) amends the ride with
// its seconds standing where the race had them, never at km 0.
func TestAnAmendAfterTheCardStandsWhereTheRaceHadIt(t *testing.T) {
	r := raceOnCut(t, racer("ana", 70), racer("ben", 70))
	var amended *RiderRecord
	saver := amendFunc(func(rec RiderRecord) { amended = &rec })
	r.ride(10+protocol.RaceNeutralSeconds+30, watts(map[string]int{"ana": 250, "ben": 250}))
	gapFrom := r.rm.session.state(r.now).Elapsed
	r.ride(120, watts(map[string]int{"ana": 250}))
	r.ride(int(gameLinger/time.Second)+5, watts(nil))
	replay := make([]protocol.RiderMetrics, 5)
	for i := range replay {
		replay[i] = protocol.RiderMetrics{Watts: 250, Seq: 10_000 + i, Clock: gapFrom + i}
	}
	var handoffs sync.WaitGroup
	r.rm.pending = &handoffs
	r.rm.backfill(r.clients["ben"], replay, slog.New(slog.DiscardHandler), saver)
	handoffs.Wait()
	if amended == nil {
		t.Fatal("the replay amended nothing")
	}
	stored(t, *amended)
}

type amendFunc func(RiderRecord)

func (amendFunc) SaveSession(_ context.Context, _, _, _, _ string, _ time.Time, _ []RiderRecord) {}
func (f amendFunc) AmendRide(_ context.Context, _, _, _, _ string, _ time.Time, rec RiderRecord) {
	f(rec)
}
