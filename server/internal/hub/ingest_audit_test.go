package hub

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// server/AGENTS.md's trust boundary for WS metrics, asserted (audit
// 2026-09-09): nothing outside these bounds reaches room state.
func TestValidMetricsBounds(t *testing.T) {
	cases := []struct {
		name string
		m    protocol.RiderMetrics
		ok   bool
	}{
		{"a rider", protocol.RiderMetrics{Watts: 250, HR: 150, Cadence: 90}, true},
		{"zero everything", protocol.RiderMetrics{}, true},
		{"the ceiling", protocol.RiderMetrics{Watts: 3000, HR: 250, Cadence: 250}, true},
		{"negative watts", protocol.RiderMetrics{Watts: -1}, false},
		{"99999 W", protocol.RiderMetrics{Watts: 99999}, false},
		{"a heart at 251", protocol.RiderMetrics{HR: 251}, false},
		{"cadence past a motor", protocol.RiderMetrics{Cadence: 251}, false},
	}
	for _, c := range cases {
		if got := validMetrics(c.m); got != c.ok {
			t.Errorf("%s: validMetrics = %v, want %v", c.name, got, c.ok)
		}
	}
}

// A start the phase refuses must not wipe the running ride (audit 2026-09-09).
func TestARefusedStartKeepsTheRecord(t *testing.T) {
	rm := newRoom("test")
	t0 := time.Unix(1000, 0)
	if !rm.control(protocol.Control{Action: "pick", WorkoutName: "x", WorkoutJSON: `{"steps":[{"type":"steady","seconds":600,"target":0.8}]}`, TotalSeconds: 600}, "jan", t0) {
		t.Fatal("pick refused")
	}
	if !rm.control(protocol.Control{Action: "start"}, "jan", t0) {
		t.Fatal("start refused")
	}
	// The tick is what moves the countdown on; stand in for it.
	rm.now = func() time.Time { return t0.Add(30 * time.Second) }
	rm.session.state(rm.now())
	rm.setMetrics(sock("jan"), protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: 1})
	if record := rm.record.byRider["jan"]; record == nil || len(record.samples) != 1 {
		t.Fatalf("recorded %v before the second start, want 1 sample", record)
	}
	if rm.control(protocol.Control{Action: "start"}, "jan", t0.Add(31*time.Second)) {
		t.Fatal("a second start while running was accepted")
	}
	if got := len(rm.record.byRider["jan"].samples); got != 1 {
		t.Fatalf("the refused start wiped the record: %d samples", got)
	}
}

// The podium is best 5 s w/kg, so a sprint admits one sample per
// wall-clock second however fast the trainer notifies (audit 2026-09-09).
func TestSprintAdmitsOneSampleASecond(t *testing.T) {
	t0 := time.Unix(2000, 0)
	sp := &sprint{startsAt: t0, endsAt: t0.Add(sprintWindow), samples: map[string][]int{}}
	for i := 0; i < 20; i++ {
		sp.collect("jan", 500+i, t0.Add(time.Second+time.Duration(i)*10*time.Millisecond))
	}
	if got := len(sp.samples["jan"]); got != 1 {
		t.Fatalf("twenty packets in one second became %d samples, want 1", got)
	}
	sp.collect("jan", 600, t0.Add(2*time.Second))
	if got := len(sp.samples["jan"]); got != 2 {
		t.Fatalf("the next second was not admitted: %d samples", got)
	}
}

// The live score leaves out what SPEC calls stopped — cadence under 5 rpm
// AND power under 20 W — the way the client's auto-pause does; it used to
// exclude only 0 W (audit 2026-09-09).
func TestLiveScoreSkipsStoppedSeconds(t *testing.T) {
	segments, err := workout.Parse(`{"steps":[{"type":"steady","seconds":600,"target":1}]}`)
	if err != nil {
		t.Fatal(err)
	}
	acc := newAccumulator()
	acc.add("jan", protocol.RiderMetrics{Watts: 10, Cadence: 0, Seq: 1}, segments, 200, 1)
	if w := acc.byRider["jan"].weight; w != 0 {
		t.Fatalf("a 10 W / 0 rpm second was scored (weight %v)", w)
	}
	acc.add("jan", protocol.RiderMetrics{Watts: 10, Cadence: 60, Seq: 2}, segments, 200, 2)
	if w := acc.byRider["jan"].weight; w == 0 {
		t.Fatal("a 10 W second with cadence was not scored")
	}
	before := acc.byRider["jan"].weight
	acc.add("jan", protocol.RiderMetrics{Watts: 25, Cadence: 0, Seq: 3}, segments, 200, 3)
	if w := acc.byRider["jan"].weight; w <= before {
		t.Fatal("a 25 W second without cadence was not scored")
	}
}

// The WS pick is held to the API's rules (audit 2026-09-09).
func TestCheckPickRefusesWhatTheAPIWould(t *testing.T) {
	ok := `{"steps":[{"type":"steady","seconds":600,"target":0.8}]}`
	cases := []struct {
		name string
		c    protocol.Control
		want string
	}{
		{"a pick", protocol.Control{WorkoutName: "Openers", WorkoutJSON: ok, TotalSeconds: 600}, ""},
		{"no name", protocol.Control{WorkoutName: "  ", WorkoutJSON: ok, TotalSeconds: 600}, "1-80 characters"},
		{"a name past 80 runes", protocol.Control{WorkoutName: strings.Repeat("ä", 81), WorkoutJSON: ok, TotalSeconds: 600}, "1-80 characters"},
		{"too much JSON", protocol.Control{WorkoutName: "x", WorkoutJSON: strings.Repeat(" ", 65<<10) + ok, TotalSeconds: 600}, "too large"},
		{"a two-day session", protocol.Control{WorkoutName: "x", WorkoutJSON: ok, TotalSeconds: 48 * 3600}, "between a second and a day"},
		{"a workout the editor refuses", protocol.Control{WorkoutName: "x", WorkoutJSON: `{"steps":[{"type":"steady","seconds":600,"target":25}]}`, TotalSeconds: 600}, "300% ceiling"},
	}
	for _, c := range cases {
		got := checkPick(c.c)
		if (c.want == "" && got != "") || (c.want != "" && !strings.Contains(got, c.want)) {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// A clipped title stays valid UTF-8 (audit 2026-09-09).
func TestClipKeepsRunesWhole(t *testing.T) {
	title := strings.Repeat("音", 300)
	if got := clip(title, 200); !utf8.ValidString(got) || utf8.RuneCountInString(got) != 200 {
		t.Fatalf("clip cut a rune: valid=%v runes=%d", utf8.ValidString(got), utf8.RuneCountInString(got))
	}
	if got := truncate("音楽室の机", 4); !utf8.ValidString(got) || got != "音楽室の" {
		t.Fatalf("truncate = %q", got)
	}
}
