package road

import (
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// docs/SPEC.md "Drafting", row by row.
func TestShelterIsSpecsTable(t *testing.T) {
	for _, c := range []struct {
		name            string
		gap             float64
		lane, lineIndex int
		want            float64
	}{
		{"the front has nothing ahead", 0.5, 0, 0, 0},
		{"the second wheel, close", 0.5, 0, 1, 0.35},
		{"the second wheel at a metre", 1.0, 0, 1, 0.35},
		{"halfway through the fade", 3.5, 0, 1, 0.175},
		{"at six metres, none", 6, 0, 1, 0},
		{"past six metres, none", 9, 0, 1, 0},
		{"the third wheel", 0.5, 0, 2, 0.45},
		{"the fourth wheel", 0.5, 0, 3, 0.5},
		{"deep in a long line, still capped", 0.5, 0, 12, 0.5},
		{"the adjacent lane, halved", 0.5, 1, 1, 0.175},
		{"the adjacent lane on the other side", 0.5, -1, 2, 0.225},
		{"two lanes over, none", 0.5, 2, 1, 0},
	} {
		if got := Shelter(c.gap, c.lane, c.lineIndex); math.Abs(got-c.want) > 1e-12 {
			t.Errorf("%s: Shelter(%v m, lane %d, wheel %d) = %v, want %v", c.name, c.gap, c.lane, c.lineIndex, got, c.want)
		}
	}
}

// No shelter is ever outside 0–ShelterMax — neither what Shelter returns nor
// what the pace takes from a caller that hands in more, or less.
func TestShelterIsClampedToTheCap(t *testing.T) {
	for gap := -2.0; gap <= 8; gap += 0.25 {
		for lane := -3; lane <= 3; lane++ {
			for line := -1; line <= 6; line++ {
				if s := Shelter(gap, lane, line); s < 0 || s > protocol.ShelterMax {
					t.Fatalf("Shelter(%v, %d, %d) = %v, outside 0–%v", gap, lane, line, s, protocol.ShelterMax)
				}
			}
		}
	}
	mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	stepAt := func(shelter float64) Pace {
		p := Pace{Speed: 10}
		for range 60 {
			p.Step(225, 0, mass, protocol.PaceDefaultCdA, shelter)
		}
		return p
	}
	same := func(a, b Pace) bool { return a.Speed == b.Speed && a.Distance == b.Distance }
	if over, capped := stepAt(0.9), stepAt(protocol.ShelterMax); !same(over, capped) {
		t.Errorf("a 90 %% shelter rode %.4f m/s, the 50 %% cap %.4f", over.Speed, capped.Speed)
	}
	if under, none := stepAt(-0.2), stepAt(0); !same(under, none) {
		t.Errorf("a negative shelter rode %.4f m/s, none %.4f", under.Speed, none.Speed)
	}
}

// #3233's acceptance: at the reference rider's 35.4 km/h on the flat, 35 %
// shelter saves 29.9 % of the power; at 6 %, where the air is a sliver of
// the work, it saves 2.0 %.
func TestShelterSavesWhatTheAirCosts(t *testing.T) {
	mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	cda := protocol.PaceDefaultCdA
	saving := func(grade float64) float64 {
		v := SteadySpeed(protocol.ReferenceRiderWatts, grade, mass, cda, 0)
		return 1 - resistance(v, grade, mass, cda, protocol.ShelterSecondWheel)/resistance(v, grade, mass, cda, 0)
	}
	if kmh := SteadySpeed(protocol.ReferenceRiderWatts, 0, mass, cda, 0) * 3.6; math.Round(kmh*10)/10 != 35.4 {
		t.Fatalf("the reference rider rides %.2f km/h on the flat, want 35.4", kmh)
	}
	for _, c := range []struct{ grade, want float64 }{{0, 29.9}, {6, 2.0}} {
		if got := math.Round(saving(c.grade)*1000) / 10; got != c.want {
			t.Errorf("at %.0f %%, 35 %% shelter saves %.2f %% of the power, want %.1f", c.grade, saving(c.grade)*100, c.want)
		}
	}
}
