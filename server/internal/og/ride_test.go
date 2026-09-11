package og

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/stats"
)

func sampleCard() RideCard {
	watts := make([]int, 45*60)
	for i := range watts {
		watts[i] = 180 + i%120 // a sawtooth that reaches Z1 through Z4
	}
	watts[1000] = 900 // one sprint, so the trace has a Z7 column
	return RideCard{
		WorkoutName: "Sweet Spot Builder",
		StartedAt:   time.Date(2026, 9, 11, 19, 42, 0, 0, time.UTC),
		RoomName:    "Sunday Sufferfest",
		Seconds:     len(watts), AvgWatts: 239, NormWatts: 248, Kj: 645,
		Ftp: 250, Xp: 1287, Execution: 0.94, ExecutionScored: true,
		Curve: stats.Curve{Best5s: 900, Best1m: 298, Best5m: 268, Best20m: 252},
		Watts: watts,
	}
}

func decode(t *testing.T, buf []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(buf))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := img.Bounds().Size(); got.X != cardSize || got.Y != cardSize {
		t.Fatalf("card is %v, want %d square", got, cardSize)
	}
	return img
}

func TestRenderRide(t *testing.T) {
	img := decode(t, mustRender(t, sampleCard()))

	// The silent failure this guards: a layout change moves the trace or the
	// zone bar off its panel and the card still renders, all background.
	for _, band := range []struct {
		what string
		box  image.Rectangle
	}{
		{"trace", image.Rect(cardMargin+32, 332, cardRight-32, 596)},
		{"zone bar", image.Rect(cardMargin+32, 620, cardRight-32, 648)},
	} {
		if !hasZoneInk(img, band.box) {
			t.Errorf("%s box has no zone colour in it — nothing was drawn there", band.what)
		}
	}
}

// TestRenderRideWithoutSamples is the ride whose blob could not be read
// (detail.go logs and carries on): the numbers are still true, so the card
// still has to come out.
func TestRenderRideWithoutSamples(t *testing.T) {
	bare := sampleCard()
	bare.Watts = nil
	bare.Curve = stats.Curve{}
	decode(t, mustRender(t, bare))

	// And the ride of an account with no FTP set: zones divide by it.
	noFtp := sampleCard()
	noFtp.Ftp = 0
	decode(t, mustRender(t, noFtp))
}

func TestRenderRideNameThatDoesNotFit(t *testing.T) {
	long := sampleCard()
	long.WorkoutName = "An Extremely Long Workout Name That Cannot Possibly Fit Across One Card"
	long.RoomName = "🔥 emoji the embedded face has no glyph for 🔥"
	decode(t, mustRender(t, long))
}

func mustRender(t *testing.T, c RideCard) []byte {
	t.Helper()
	buf, err := RenderRide(c)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	return buf
}

// hasZoneInk reports whether any pixel in box is closer to a zone colour than
// to the card's own surfaces.
func hasZoneInk(img image.Image, box image.Rectangle) bool {
	for y := box.Min.Y; y < box.Max.Y; y += 4 {
		for x := box.Min.X; x < box.Max.X; x += 4 {
			for zone := 1; zone <= 7; zone++ {
				if near(img.At(x, y), zoneInk[zone]) {
					return true
				}
			}
		}
	}
	return false
}

func near(got color.Color, want color.NRGBA) bool {
	r, g, b, _ := got.RGBA()
	d := func(a uint32, b uint8) int {
		delta := int(a>>8) - int(b)
		if delta < 0 {
			return -delta
		}
		return delta
	}
	return d(r, want.R)+d(g, want.G)+d(b, want.B) < 24
}
