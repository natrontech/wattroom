package og

import (
	"flag"
	"image"
	"image/color"
	"os"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the poster's golden image")

const posterGoldenPath = "testdata/poster.golden.png"

// roadCard is a road ride (#3142): 3 km flat, a 6 km climb, 3 km down, at a
// flat 220 W — so anything in the silhouette's shape comes from the road,
// never from the watts.
func roadCard() RideCard {
	c := sampleCard()
	c.WorkoutName = "Road · 12.0 km · 360 m"
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

// topEdge is the first row from the top of box, in column x, that carries
// zone paint: where the silhouette's line is.
func topEdge(img image.Image, box image.Rectangle, x int) int {
	for y := box.Min.Y; y < box.Max.Y; y++ {
		for zone := 1; zone <= 7; zone++ {
			if near(img.At(x, y), zoneInk[zone]) {
				return y
			}
		}
	}
	return box.Max.Y
}

// The silent failure: a road ride that still draws its watts. The watts are
// flat here, so a trace would draw a flat line; the road climbs for half the
// box and falls away, and the poster has to show exactly that.
func TestAPosterDrawsTheRoadItRode(t *testing.T) {
	img := decode(t, mustRender(t, roadCard()))
	at := func(frac float64) int {
		return topEdge(img, traceBox, traceBox.Min.X+int(frac*float64(traceBox.Dx())))
	}
	start, summit, end := at(0.1), at(0.74), at(0.98)
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
