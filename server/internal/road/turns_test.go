package road

import (
	"encoding/json"
	"os"
	"testing"
)

// The server's TurnsOfShape is the browser's turnsOf over the same line
// (testdata/turns-golden.json, written by web/src/lib/road/turns.golden.test.ts).
// Its atan2 may differ from JavaScript's in the last bit, so a turn may land
// one degree over and the next one under; the heading they add up to never
// drifts by more than a degree.
func TestTurnsOfShapeMatchesTheBrowser(t *testing.T) {
	raw, err := os.ReadFile("testdata/turns-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Vectors []struct {
			Name  string `json:"name"`
			Shape string `json:"shape"`
			Every int    `json:"every"`
			Turns []int  `json:"turns"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Vectors) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range golden.Vectors {
		t.Run(v.Name, func(t *testing.T) {
			points, err := DecodePolyline6(v.Shape, 1<<20)
			if err != nil {
				t.Fatal(err)
			}
			got := TurnsOfShape(points, v.Every)
			if len(got) != len(v.Turns) {
				t.Fatalf("%d turns, want %d", len(got), len(v.Turns))
			}
			drift, off := 0, 0
			for i := range got {
				if int(got[i]) != v.Turns[i] {
					off++
				}
				drift += int(got[i]) - v.Turns[i]
				if drift < -1 || drift > 1 {
					t.Fatalf("at step %d the heading is %d° from the browser's", i, drift)
				}
			}
			if off > len(got)/100 {
				t.Fatalf("%d of %d turns differ from the browser's", off, len(got))
			}
		})
	}
}
