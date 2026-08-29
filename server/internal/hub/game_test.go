package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func gat(sec int) time.Time { return time.Unix(3_000_000+int64(sec), 0) }

func backyardRoster() map[string]protocol.Rider {
	return map[string]protocol.Rider{
		"a": {ID: "a", Name: "A", FtpWatts: 200, WeightKg: 75},
		"b": {ID: "b", Name: "B", FtpWatts: 300, WeightKg: 80},
	}
}

func TestBackyardEliminatesAfterTenSecondsBelow(t *testing.T) {
	b := newBackyard(gat(0), false)
	roster := backyardRoster()
	// Round 1 line: 80 %. A rides 160 (on it), B soft-pedals 100 (way below 240).
	for sec := 1; sec <= 9; sec++ {
		b.advance(gat(sec), map[string]int{"a": 160, "b": 100}, roster)
	}
	if b.out["b"] {
		t.Fatal("eliminated before 10 s")
	}
	b.advance(gat(10), map[string]int{"a": 160, "b": 100}, roster)
	if !b.out["b"] {
		t.Fatal("not eliminated at 10 s")
	}
	// One rider left: game over, podium survivor-first.
	if !b.done() {
		t.Fatal("game did not end with one rider standing")
	}
	st := b.state(gat(11))
	if st.Phase != "done" || st.Podium[0].Name != "A" {
		t.Fatalf("podium: %+v", st.Podium)
	}
	// Eliminated rider's target drops to the recovery ERG.
	if st.Riders["b"].TargetPct != eliminatedPct || !st.Riders["b"].Eliminated {
		t.Fatalf("eliminated rider state: %+v", st.Riders["b"])
	}
}

func TestBackyardRecoveryResetsTheClock(t *testing.T) {
	b := newBackyard(gat(0), false)
	roster := backyardRoster()
	// 9 s below, then back on the line: the elimination clock resets (the rule
	// is 10 s CONTINUOUSLY below).
	for sec := 1; sec <= 9; sec++ {
		b.advance(gat(sec), map[string]int{"a": 100, "b": 250}, roster)
	}
	b.advance(gat(10), map[string]int{"a": 165, "b": 250}, roster)
	for sec := 11; sec <= 19; sec++ {
		b.advance(gat(sec), map[string]int{"a": 100, "b": 250}, roster)
	}
	if b.out["a"] {
		t.Fatal("continuity rule broken: non-consecutive seconds eliminated")
	}
}

func TestBackyardDisconnectGrace(t *testing.T) {
	b := newBackyard(gat(0), false)
	roster := backyardRoster()
	b.advance(gat(1), map[string]int{"a": 160, "b": 250}, roster)
	// A vanishes (wifi): silent seconds within the 30 s grace do not count.
	for sec := 2; sec <= 25; sec++ {
		b.advance(gat(sec), map[string]int{"b": 250}, roster)
	}
	if b.out["a"] {
		t.Fatal("eliminated by wifi inside the grace window")
	}
	// Past the grace, silence is real: the below-clock starts.
	for sec := 32; sec <= 42; sec++ {
		b.advance(gat(sec), map[string]int{"b": 250}, roster)
	}
	if !b.out["a"] {
		t.Fatal("lapsed rider survived forever")
	}
}

func TestBackyardLineClimbs(t *testing.T) {
	b := newBackyard(gat(0), false)
	if b.linePct() != 0.80 {
		t.Fatalf("round 1 line: %v", b.linePct())
	}
	b.advance(gat(181), map[string]int{"a": 200}, backyardRoster())
	if b.round != 2 || b.linePct() != 0.85 {
		t.Fatalf("round 2: r%d line %v", b.round, b.linePct())
	}
}

func TestCollectiveJudgesTheAverage(t *testing.T) {
	b := newBackyard(gat(0), true)
	roster := backyardRoster()
	// Line 75 % of summed FTP (500): 375 W. Together they hold 380 — alive.
	for sec := 1; sec <= 15; sec++ {
		b.advance(gat(sec), map[string]int{"a": 152, "b": 228}, roster)
	}
	if b.done() {
		t.Fatal("room died while holding the line together")
	}
	// One rider collapses; the average falls under: the room goes down as one.
	for sec := 16; sec <= 26; sec++ {
		b.advance(gat(sec), map[string]int{"a": 152, "b": 60}, roster)
	}
	if !b.done() {
		t.Fatal("collective line held on 42 % avg")
	}
	if got := b.state(gat(27)); got.Mode != "collective-ramp" || got.Phase != "done" {
		t.Fatalf("state: %+v", got)
	}
}

func TestGameRegistry(t *testing.T) {
	if newGameMode("backyard-ramp", gat(0)) == nil || newGameMode("collective-ramp", gat(0)) == nil {
		t.Fatal("registry missing ramp modes")
	}
	if newGameMode("calvinball", gat(0)) != nil {
		t.Fatal("registry invented a mode")
	}
}
