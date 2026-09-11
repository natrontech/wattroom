package og

import (
	"image"
	"image/color"
)

// The card's icons, traced from the lucide set the app draws everywhere else
// (#2112): same 24-unit grid, same round caps, same 2-unit stroke. Six of
// them, each named for the lucide icon it is — a seventh is a function, not a
// dependency.

type icon func(p pen)

// iconClock — how long it took.
func iconClock(p pen) {
	p.ring(point{12, 12}, 9)
	p.stroke(point{12, 6.5}, point{12, 12}, point{16, 14})
}

// iconZap — the power it was ridden at. Solid, so the one icon on the card
// that stands for watts reads as a mark rather than an outline.
func iconZap(p pen) {
	p.fill(
		point{13, 2}, point{3, 14}, point{12, 14},
		point{11, 22}, point{21, 10}, point{12, 10},
	)
}

// iconActivity — normalised power: the trace, as a shape.
func iconActivity(p pen) {
	p.stroke(
		point{3, 12}, point{7, 12}, point{9.5, 5},
		point{14.5, 19}, point{17, 12}, point{21, 12},
	)
}

// iconFlame — the work done, in kilojoules. The lucide flame: an outer body
// that comes to a point, and the inner tongue that stops it reading as a drop.
func iconFlame(p pen) {
	b := newBrush(p.box())
	to := func(g point) (float64, float64) { return p.place(g) }
	curve := func(c1, c2, end point) {
		c1x, c1y := to(c1)
		c2x, c2y := to(c2)
		ex, ey := to(end)
		b.cubeTo(c1x, c1y, c2x, c2y, ex, ey)
	}
	x, y := to(point{12, 1.5})
	b.moveTo(x, y)
	curve(point{13, 6}, point{18.5, 8.5}, point{18.5, 14})
	curve(point{18.5, 18.4}, point{15.6, 22}, point{12, 22})
	curve(point{8.4, 22}, point{5.5, 18.4}, point{5.5, 14})
	curve(point{5.5, 11}, point{7, 9.5}, point{8.6, 6.8})
	curve(point{8.6, 10}, point{10, 11.6}, point{11.2, 11.6})
	curve(point{12.6, 11.6}, point{13.4, 8.5}, point{12, 1.5})
	b.close()
	b.paint(p.dst, p.ink)
}

// iconTarget — how close the ride was to what the workout asked for.
func iconTarget(p pen) {
	p.ring(point{12, 12}, 9)
	p.ring(point{12, 12}, 4.5)
}

// iconTrophy — what the ride earned. Fewer strokes than lucide's: at 30 px
// its two handles and its rim were one smudge.
func iconTrophy(p pen) {
	p.stroke(point{6.5, 4}, point{17.5, 4})
	p.stroke(point{6.5, 4}, point{6.5, 9}, point{9, 13.5}, point{15, 13.5}, point{17.5, 9}, point{17.5, 4})
	p.stroke(point{6.5, 6}, point{3.5, 6}, point{4, 9.5}, point{7, 10.5})
	p.stroke(point{17.5, 6}, point{20.5, 6}, point{20, 9.5}, point{17, 10.5})
	p.stroke(point{12, 13.5}, point{12, 17.5})
	p.stroke(point{8, 20.5}, point{16, 20.5})
	p.stroke(point{9.5, 20.5}, point{10.5, 17.5}, point{13.5, 17.5}, point{14.5, 20.5})
}

// draw puts one icon at (x, y) on a size-square box.
func (i icon) draw(dst *image.NRGBA, x, y, size float64, c color.NRGBA) {
	// 2.2 rather than lucide's 2: the card is looked at small, in a feed.
	i(pen{dst: dst, x: x, y: y, size: size, width: 2.2, ink: c})
}
