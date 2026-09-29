package road

import (
	"encoding/json"
	"os"
	"testing"
)

// The climb rule's golden vectors (#3238), written by the TypeScript twin —
// the roads are #3023's fixtures, which live on that side — and read here:
// `UPDATE_GOLDEN=1 pnpm exec vitest run src/lib/road/climbs.golden.test.ts`
// in web/ rewrites them.
const climbsGoldenPath = "../protocol/testdata/climbs-golden.json"

// Same bytes, same operations, same order: the Go twin lands on exactly the
// centimetres $lib/road's climbsOf wrote, not merely near them.
func TestClimbsMatchTheTypeScriptTwin(t *testing.T) {
	raw, err := os.ReadFile(climbsGoldenPath)
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Vectors []struct {
			Name    string    `json:"name"`
			Length  float64   `json:"length"`
			Heights []float64 `json:"heights"`
			Climbs  []Climb   `json:"climbs"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Vectors) == 0 {
		t.Fatal("no vectors to agree on")
	}
	for _, v := range g.Vectors {
		got := ClimbsOf(Road{LengthM: v.Length, Heights: v.Heights})
		if len(got) != len(v.Climbs) {
			t.Errorf("%s: %d climbs %+v, the TypeScript twin found %d %+v", v.Name, len(got), got, len(v.Climbs), v.Climbs)
			continue
		}
		for i := range got {
			if got[i] != v.Climbs[i] {
				t.Errorf("%s, climb %d: %+v, the TypeScript twin wrote %+v", v.Name, i, got[i], v.Climbs[i])
			}
		}
	}
}

func TestClimbClassIsAboveItsFloor(t *testing.T) {
	for _, c := range []struct {
		score float64
		want  string
	}{
		{8000, ""}, {8000.01, "IV"}, {16000, "IV"}, {16000.01, "III"},
		{32000.01, "II"}, {64000.01, "I"}, {80000, "I"}, {80000.01, "HC"},
	} {
		if got := ClimbClass(c.score); got != c.want {
			t.Errorf("ClimbClass(%v) = %q, want %q", c.score, got, c.want)
		}
	}
}
