package road

import (
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/testx"
)

// A 2 km road sampled every 20 m: up 2 % to 1 km, then down 1 %.
func upThenDown(t *testing.T) Road {
	t.Helper()
	heights := make([]float64, 101)
	for i := range heights {
		if i <= 50 {
			heights[i] = 100 + 0.4*float64(i)
		} else {
			heights[i] = 120 - 0.2*float64(i-50)
		}
	}
	r, err := UnpackRoad(testx.PackedRoad(2000, heights))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestReadingARoadByDistance(t *testing.T) {
	r := upThenDown(t)
	for _, c := range []struct {
		name      string
		got, want float64
	}{
		{"height at the start", r.HeightAt(0), 100},
		{"height between samples", r.HeightAt(10), 100.2},
		{"height at the top", r.HeightAt(1000), 120},
		{"height past the end is the end's", r.HeightAt(2500), 110},
		{"height before the start is the start's", r.HeightAt(-5), 100},
		{"grade on the way up", r.GradeAt(500), 2},
		{"grade on the way down", r.GradeAt(1500), -1},
		{"grade at the very end", r.GradeAt(2000), -1},
		{"the whole road climbs its rise", r.ClimbedBetween(0, 2000), 20},
		{"a stretch across the top climbs only its own rise", r.ClimbedBetween(500, 1500), 10},
		{"a descent climbs nothing", r.ClimbedBetween(1500, 1900), 0},
		{"a stretch inside one step climbs its share", r.ClimbedBetween(10, 30), 0.4},
		{"nothing ridden climbs nothing", r.ClimbedBetween(700, 700), 0},
	} {
		if math.Abs(c.got-c.want) > 1e-9 {
			t.Errorf("%s: %v, want %v", c.name, c.got, c.want)
		}
	}
}
