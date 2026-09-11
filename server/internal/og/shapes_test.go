package og

import (
	"image"
	"testing"
)

// A stroke is a pile of quads with a disc at every node, and the rasterizer
// adds signed area: wind the discs against the quads and each joint punches a
// bite out of the line it was meant to round. Nothing errors, every icon
// still draws, and the corners are chewed — so it needs a test.
func TestStrokeJointsAddRatherThanCancel(t *testing.T) {
	dst := image.NewNRGBA(image.Rect(0, 0, 60, 60))
	fill(dst, dst.Bounds(), surface)
	// An L in the 24-grid: the elbow is a node, and its disc lands on top of
	// both segments.
	pen{dst: dst, x: 0, y: 0, size: 48, width: 4, ink: ink}.
		stroke(point{6, 6}, point{6, 18}, point{18, 18})

	elbow := dst.NRGBAAt(12, 36) // the (6,18) node, scaled by 48/24
	if elbow.R < 0xf0 || elbow.G < 0xf0 || elbow.B < 0xf0 {
		t.Errorf("the elbow of a stroked polyline is %v, want the ink it was drawn in", elbow)
	}
}

func TestRoundRectLosesItsCorners(t *testing.T) {
	dst := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	fill(dst, dst.Bounds(), surface)
	fillRound(dst, image.Rect(10, 10, 90, 90), 24, ink)

	if got := dst.NRGBAAt(50, 50); got != ink {
		t.Errorf("middle of a rounded rect is %v, want %v", got, ink)
	}
	if got := dst.NRGBAAt(12, 12); got != surface {
		t.Errorf("corner of a rounded rect is %v, want the background %v", got, surface)
	}
}

func TestRoundMaskIsRound(t *testing.T) {
	mask := roundMask(image.Rect(40, 40, 140, 100), 30)
	for _, tc := range []struct {
		name string
		x, y int
		want bool
	}{
		{"middle", 50, 30, true},
		{"top-left corner", 1, 1, false},
		{"bottom-right corner", 98, 58, false},
	} {
		if got := mask.AlphaAt(tc.x, tc.y).A > 0x80; got != tc.want {
			t.Errorf("%s of the mask: covered = %v, want %v", tc.name, got, tc.want)
		}
	}
}
