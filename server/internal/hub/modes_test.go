package hub

import (
	"math/rand"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func fixedRng() *rand.Rand { return rand.New(rand.NewSource(42)) } //nolint:gosec // test determinism

func TestLavaBurnsLivesAndEliminates(t *testing.T) {
	l := newLava(gat(0), fixedRng())
	roster := backyardRoster()
	zone := l.zone
	low := zoneBounds[zone][0]
	inZone := int(low*200) + 5 // rider a (FTP 200) inside the called zone

	// b camps far outside the zone: 5 s grace, then a life per breach cycle.
	for sec := 1; sec <= 40; sec++ {
		l.advance(gat(sec), map[string]int{"a": inZone, "b": 900}, roster)
		if l.zone != zone {
			zone = l.zone
			low = zoneBounds[zone][0]
			inZone = int(low*200) + 5
		}
	}
	if l.lives["b"] >= lavaLives {
		t.Fatalf("no life burned: %d", l.lives["b"])
	}
	if !l.out["b"] || !l.done() {
		t.Fatalf("lava never ate the camper (lives=%d out=%v)", l.lives["b"], l.out["b"])
	}
	if l.state(gat(41)).Podium[0].Name != "A" {
		t.Fatalf("podium: %+v", l.podium)
	}
}

func TestGolfScoresDeviation(t *testing.T) {
	g := newGolf(gat(0), fixedRng())
	roster := backyardRoster()
	targetA := int(g.holePct * 200) // per-rider absolute targets: the same
	targetB := int(g.holePct * 300) // course shape at each rider's own FTP

	// Window is 20..30 s: a nails it, b misses by 50 W every second.
	for sec := 21; sec <= 29; sec++ {
		g.advance(gat(sec), map[string]int{"a": targetA, "b": targetB + 50}, roster)
	}
	g.advance(gat(31), map[string]int{"a": 0, "b": 0}, roster) // close the hole
	if g.strokes["a"] > 0.01 {                                 // float crumbs from pct*ftp, not real strokes
		t.Fatalf("perfect hole scored strokes: %v", g.strokes["a"])
	}
	if g.strokes["b"] < 40 {
		t.Fatalf("missed hole scored too few strokes: %v", g.strokes["b"])
	}
	// The next hole is announced after the gap, not the instant this one is
	// scored (#2234) — see TestGolfShowsTheMeterBetweenHoles.
	g.advance(gat(31+int(golfBetween/time.Second)), map[string]int{"a": 0, "b": 0}, roster)
	if g.hole != 2 {
		t.Fatalf("did not tee the next hole: %d", g.hole)
	}
	// The meter hides through the lead-in and window (SPEC).
	if st := g.state(g.holeAt.Add(-5 * time.Second)); !st.MeterHidden {
		t.Fatal("meter visible during lead-in")
	}
}

// SPEC: "meter hidden from 20 s before to hole end". The other side of that
// sentence is that between holes it is NOT hidden, and it never was (#2234):
// tee sets holeAt = teeTime + golfLeadIn, so the hidden span is exactly the
// lead-in plus the hole — and the tee fired the instant the previous hole was
// scored, which made the hidden spans touch. golfBetween existed and bought
// nothing. A rider played nine holes with no numbers at all, and the mode
// that hides the meter on purpose is the one where that looks intended.
func TestGolfShowsTheMeterBetweenHoles(t *testing.T) {
	g := newGolf(gat(0), fixedRng())
	roster := backyardRoster()

	// Hole 1: announced at 0, window 20..30.
	if st := g.state(gat(5)); !st.MeterHidden {
		t.Fatal("meter visible during the first lead-in")
	}
	if st := g.state(gat(25)); !st.MeterHidden {
		t.Fatal("meter visible during the hole")
	}
	g.advance(gat(31), map[string]int{"a": 200, "b": 300}, roster) // close it

	// The gap: hole 1 is scored, hole 2 is not announced, the meter is back.
	if g.hole != 1 {
		t.Fatalf("hole %d teed inside the gap", g.hole)
	}
	for _, sec := range []int{31, 40, 50} {
		if st := g.state(gat(sec)); st.MeterHidden {
			t.Errorf("meter still hidden %ds into the gap between holes", sec-31)
		}
	}

	// And it hides again as soon as the next hole is announced.
	g.advance(gat(51), map[string]int{"a": 200, "b": 300}, roster)
	if g.hole != 2 {
		t.Fatalf("hole 2 was not announced after the gap: hole %d", g.hole)
	}
	if st := g.state(gat(51)); !st.MeterHidden {
		t.Error("meter still visible once hole 2 was announced")
	}
	if g.holeAt != gat(51).Add(golfLeadIn) {
		t.Errorf("hole 2 opens at %v, want %v — the lead-in is what the rider is told", g.holeAt, gat(51).Add(golfLeadIn))
	}
}

func TestRouletteScoresBestAcrossSprints(t *testing.T) {
	r := newRoulette(gat(0), fixedRng())
	roster := backyardRoster()
	// Drive time forward far enough to consume all five sprints.
	watts := map[string]int{"a": 400, "b": 700}
	for sec := 1; sec < 3600 && !r.done(); sec++ {
		r.advance(gat(sec), watts, roster)
	}
	if !r.done() {
		t.Fatal("roulette never finished five sprints")
	}
	if r.podium[0].Name != "B" {
		t.Fatalf("podium: %+v", r.podium)
	}
	if r.podium[0].Wkg < 8 { // 700/80 = 8.75
		t.Fatalf("score: %+v", r.podium[0])
	}
}

func TestPointsRaceAwards(t *testing.T) {
	p := newPointsRace(gat(0), fixedRng())
	roster := backyardRoster()
	// a holds one zone forever (streak points); b sprints harder (sprint points).
	for sec := 1; sec < 3600 && !p.done(); sec++ {
		p.advance(gat(sec), map[string]int{"a": 130, "b": 600}, roster)
	}
	if !p.done() {
		t.Fatal("points race never ended")
	}
	if p.points["b"] < 5*float64(pointsSprints) {
		t.Fatalf("sprint points missing: %v", p.points["b"])
	}
	if p.points["a"] < 2 {
		t.Fatalf("zone streak never paid: %v", p.points["a"])
	}
	if p.podium[0].Name != "B" {
		t.Fatalf("podium: %+v", p.podium)
	}
}

func TestPointsRaceAwardsFinalSprint(t *testing.T) {
	p := newPointsRace(gat(0), fixedRng())
	p.roulette.sprintNo = rouletteSprints
	p.roulette.window = &sprint{startsAt: gat(1), endsAt: gat(15), samples: map[string][]sprintSample{"a": consecutive(300, 300, 300, 300, 300), "b": consecutive(600, 600, 600, 600, 600)}}
	p.advance(gat(16), map[string]int{"a": 300, "b": 600}, backyardRoster())
	if !p.finished || p.points["a"] != 3 || p.points["b"] != 8 {
		t.Fatalf("last sprint points: a=%v b=%v; expected 3 and 8", p.points["a"], p.points["b"])
	}
	if len(p.podium) != 2 || p.podium[0].RiderID != "b" {
		t.Fatalf("podium: %+v", p.podium)
	}
	p.advance(gat(17), nil, backyardRoster())
	if p.points["b"] != 8 {
		t.Fatalf("final sprint paid twice: %v", p.points["b"])
	}
}

func TestRelayRotatesAndAccumulates(t *testing.T) {
	r := newRelay(gat(0), fixedRng())
	roster := backyardRoster()
	for sec := 1; sec <= 200; sec++ {
		r.advance(gat(sec), map[string]int{"a": 220, "b": 330}, roster)
	}
	if r.distance == 0 {
		t.Fatal("no distance accumulated")
	}
	st := r.state(gat(201))
	fronts := 0
	for _, rider := range st.Riders {
		if rider.OnFront {
			fronts++
			if rider.TargetPct != relayFrontPct {
				t.Fatalf("front target: %v", rider.TargetPct)
			}
		} else if rider.TargetPct != relayRestPct {
			t.Fatalf("rest target: %v", rider.TargetPct)
		}
	}
	if fronts != 1 {
		t.Fatalf("paceline has %d riders on front", fronts)
	}
	if r.front == 0 && r.rotateAt.Before(gat(200)) {
		t.Fatal("never rotated")
	}
	if r.done() {
		t.Fatal("a relay has no natural end")
	}
}

func TestFullRegistry(t *testing.T) {
	for _, mode := range []string{"backyard-ramp", "collective-ramp", "floor-is-lava", "watt-golf", "sprint-roulette", "points-race", "team-relay"} {
		if newGameMode(mode, gat(0)) == nil {
			t.Fatalf("registry missing %s", mode)
		}
	}
	var _ protocol.GameState // keep the import honest
}
