package og

import (
	"flag"
	"image/color"
	"os"
	"slices"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the poster's golden image")

const posterGoldenPath = "testdata/poster.golden.png"

// roadCard is a road ride (#3142): 3 km flat, a 6 km climb, 3 km down, at a
// flat 220 W — so anything in the silhouette's shape comes from the road,
// never from the watts.
func roadCard() RideCard {
	c := sampleCard()
	c.WorkoutName = "Virtual route ride · 12.0 km"
	c.RoadM, c.ClimbM = 12000, 360
	n := 40 * 60
	c.Watts = make([]int, n)
	c.Metres = make([]float64, n)
	c.Heights = make([]float64, n)
	for i := range n {
		m := 12000 * float64(i) / float64(n-1)
		c.Watts[i] = 220
		c.Metres[i] = m
		switch {
		case m < 3000:
			c.Heights[i] = 500
		case m < 9000:
			c.Heights[i] = 500 + 0.06*(m-3000)
		default:
			c.Heights[i] = 860 - 0.12*(m-9000)
		}
	}
	c.Watts[n/2] = 900 // one sprint on the climb, so a Z7 column shows
	c.HeightCredit = "Heights from the route's own file"
	return c
}

// The silent failure: a road ride that draws no road. The watts are flat
// here, so their line is level; the road climbs for half the box and falls
// away under it, and the poster has to show exactly that.
func TestAPosterDrawsTheRoadItRode(t *testing.T) {
	ride := roadCard()
	ride.Watts[len(ride.Watts)/2] = 220 // no sprint: the line stays level
	img := decode(t, mustRender(t, ride))
	pal := Palette{}.orDefault()
	at := func(frac float64) int {
		x := posterBox.Min.X + int(frac*float64(posterBox.Dx()))
		// Below the power line and its halo, the first row that is not the
		// panel's own colour is the road's edge.
		y := posterBox.Min.Y
		for ; y < posterBox.Max.Y && !near(img.At(x, y), pal.ink); y++ {
		}
		for y += 12; y < posterBox.Max.Y; y++ {
			if !alike(img.At(x, y), pal.raised) && !near(img.At(x, y), pal.neon) {
				return y
			}
		}
		return posterBox.Max.Y
	}
	start, summit, end := at(0.1), at(0.74), at(0.95)
	if summit >= start-60 || summit >= end-60 {
		t.Errorf("the silhouette's top sits at %d, %d and %d px along the road; want the summit well above both ends", start, summit, end)
	}
}

// A ride on no road stays a trace, and a poster with no credit prints none.
func TestACardWithoutARoadIsStillATrace(t *testing.T) {
	img := decode(t, mustRender(t, sampleCard()))
	if !hasZoneInk(img, traceBox) {
		t.Error("a workout ride lost its trace")
	}
	half := roadCard()
	half.Metres = half.Metres[:10] // not a metre per second: not a road
	decode(t, mustRender(t, half))
}

// The golden image: the poster as it is meant to look, compared pixel by
// pixel within a small tolerance — the scaler's float arithmetic may round
// differently on another architecture, and that is not a changed poster.
// `go test ./internal/og -run Golden -update` rewrites it after a deliberate
// change, which the reviewer then looks at.
func TestThePosterMatchesItsGoldenImage(t *testing.T) {
	got := mustRender(t, roadCard())
	if *update {
		if err := os.MkdirAll("testdata", 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(posterGoldenPath, got, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(posterGoldenPath)
	if err != nil {
		t.Fatalf("no golden poster (run with -update): %v", err)
	}
	a, b := decode(t, got), decode(t, want)
	off := 0
	for y := range cardSize {
		for x := range cardSize {
			if !alike(a.At(x, y), b.At(x, y)) {
				off++
			}
		}
	}
	if off > cardSize*cardSize/200 {
		t.Errorf("%d pixels differ from the golden poster (at most %d may)", off, cardSize*cardSize/200)
	}
}

// alike is two pixels within a rounding of each other.
func alike(got, want color.Color) bool {
	gr, gg, gb, _ := got.RGBA()
	wr, wg, wb, _ := want.RGBA()
	d := func(a, b uint32) uint32 {
		if a > b {
			return (a - b) >> 8
		}
		return (b - a) >> 8
	}
	return d(gr, wr) <= 8 && d(gg, wg) <= 8 && d(gb, wb) <= 8
}

// The poster's power is a 30 s average (#3142): watts that swing between 0
// and 400 W every five seconds draw a level line at their 200 W mean, not a
// comb from the floor to the top of the box.
func TestThePosterSmoothsItsPower(t *testing.T) {
	ride := roadCard()
	for i := range ride.Watts {
		ride.Watts[i] = 400 * (i / 5 % 2)
	}
	img := decode(t, mustRender(t, ride))
	ink := Palette{}.orDefault().ink
	lo, hi := posterBox.Max.Y, posterBox.Min.Y
	for x := posterBox.Min.X + 40; x < posterBox.Max.X-40; x += 3 {
		for y := posterBox.Min.Y; y < posterBox.Max.Y; y++ {
			if near(img.At(x, y), ink) {
				lo, hi = min(lo, y), max(hi, y)
			}
		}
	}
	if hi < lo {
		t.Fatal("no power line drawn on the poster")
	}
	if hi-lo > 40 {
		t.Errorf("the power line spans %d px from its highest to its lowest; want a level 30 s average", hi-lo)
	}
}

func TestRollingAverage(t *testing.T) {
	watts := make([]int, 120)
	for i := range watts {
		watts[i] = 200
	}
	watts[60] = 1100 // one second's spike
	got := rollingAverage(watts, 30)
	if got[0] != 200 || got[119] != 200 {
		t.Errorf("the ends read %v and %v, want 200", got[0], got[119])
	}
	if peak := slices.Max(got); peak != 230 {
		t.Errorf("a one-second spike of 900 W over the rest averages to a peak of %v, want 230", peak)
	}
}
