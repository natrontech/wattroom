package og

import (
	"image"
	"image/color"
	"math"

	"golang.org/x/image/vector"
)

// Antialiased vector drawing for the ride card (#2112). image/draw fills
// rectangles and nothing else, which is why the first card was all hard
// corners and no icons. x/image/vector is already here for the fonts'
// module; a rasterizer plus three primitives — a rounded rectangle, a
// stroked polyline, a stroked circle — is every shape the card draws,
// icons included.

// brush accumulates one path in card coordinates and paints it in one colour.
// It is sized to the path's own box: a rasterizer the size of the card, one
// per shape, is 4 MB a shape for nothing.
type brush struct {
	rast *vector.Rasterizer
	box  image.Rectangle
}

// newBrush takes the box the path lives in — bounds beyond it are clipped, so
// give a stroke room for its own width.
func newBrush(box image.Rectangle) *brush {
	return &brush{rast: vector.NewRasterizer(box.Dx(), box.Dy()), box: box}
}

func (b *brush) at(x, y float64) (float32, float32) {
	return float32(x - float64(b.box.Min.X)), float32(y - float64(b.box.Min.Y))
}

func (b *brush) moveTo(x, y float64) { b.rast.MoveTo(b.at(x, y)) }
func (b *brush) lineTo(x, y float64) { b.rast.LineTo(b.at(x, y)) }

func (b *brush) quadTo(cx, cy, x, y float64) {
	ax, ay := b.at(cx, cy)
	px, py := b.at(x, y)
	b.rast.QuadTo(ax, ay, px, py)
}

func (b *brush) cubeTo(c1x, c1y, c2x, c2y, x, y float64) {
	ax, ay := b.at(c1x, c1y)
	bx, by := b.at(c2x, c2y)
	px, py := b.at(x, y)
	b.rast.CubeTo(ax, ay, bx, by, px, py)
}

func (b *brush) close() { b.rast.ClosePath() }

// paint composites the accumulated path over dst. Overlapping subpaths are
// safe whichever way they wind, which is what lets a stroke be a pile of
// quads and joint circles.
func (b *brush) paint(dst *image.NRGBA, c color.NRGBA) {
	b.rast.Draw(dst, b.box, image.NewUniform(c), image.Point{})
}

// fillRound is the card's panels, tiles and pills.
func fillRound(dst *image.NRGBA, r image.Rectangle, radius float64, c color.NRGBA) {
	b := newBrush(r)
	roundRect(b, r, radius)
	b.paint(dst, c)
}

func roundRect(b *brush, r image.Rectangle, radius float64) {
	x0, y0 := float64(r.Min.X), float64(r.Min.Y)
	x1, y1 := float64(r.Max.X), float64(r.Max.Y)
	radius = math.Min(radius, math.Min(x1-x0, y1-y0)/2)
	b.moveTo(x0+radius, y0)
	b.lineTo(x1-radius, y0)
	b.quadTo(x1, y0, x1, y0+radius)
	b.lineTo(x1, y1-radius)
	b.quadTo(x1, y1, x1-radius, y1)
	b.lineTo(x0+radius, y1)
	b.quadTo(x0, y1, x0, y1-radius)
	b.lineTo(x0, y0+radius)
	b.quadTo(x0, y0, x0+radius, y0)
	b.close()
}

// point is one node of an icon path, in the 24-unit grid lucide draws on.
type point struct{ x, y float64 }

// pen carries where an icon is being drawn and how heavily, so the icon
// functions read as their lucide source rather than as arithmetic.
type pen struct {
	dst   *image.NRGBA
	x, y  float64 // top-left of the icon's box, in card coordinates
	size  float64 // the box is square
	width float64 // stroke width, in grid units
	ink   color.NRGBA
}

func (p pen) place(g point) (float64, float64) {
	return p.x + g.x/24*p.size, p.y + g.y/24*p.size
}

func (p pen) scaled(units float64) float64 { return units / 24 * p.size }

func (p pen) box() image.Rectangle {
	pad := int(p.scaled(p.width)) + 2
	return image.Rect(int(p.x)-pad, int(p.y)-pad, int(p.x+p.size)+pad, int(p.y+p.size)+pad)
}

// stroke draws a polyline with round joints and caps — a rectangle per
// segment, a disc per node, all in one path.
func (p pen) stroke(nodes ...point) {
	b := newBrush(p.box())
	half := p.scaled(p.width) / 2
	for i := 0; i+1 < len(nodes); i++ {
		x0, y0 := p.place(nodes[i])
		x1, y1 := p.place(nodes[i+1])
		dx, dy := x1-x0, y1-y0
		length := math.Hypot(dx, dy)
		if length == 0 {
			continue
		}
		nx, ny := -dy/length*half, dx/length*half
		b.moveTo(x0+nx, y0+ny)
		b.lineTo(x1+nx, y1+ny)
		b.lineTo(x1-nx, y1-ny)
		b.lineTo(x0-nx, y0-ny)
		b.close()
	}
	// Every node gets its disc, the ends included: round caps and round joins,
	// the way lucide draws.
	if len(nodes) > 1 {
		for _, node := range nodes {
			x, y := p.place(node)
			disc(b, x, y, half)
		}
	}
	b.paint(p.dst, p.ink)
}

// ring is a stroked circle: the outer disc with the inner one wound the other
// way, which the rasterizer's own fill rule cuts out.
func (p pen) ring(centre point, radius float64) {
	b := newBrush(p.box())
	cx, cy := p.place(centre)
	r := p.scaled(radius)
	half := p.scaled(p.width) / 2
	disc(b, cx, cy, r+half)
	holeOut(b, cx, cy, r-half)
	b.paint(p.dst, p.ink)
}

// fill draws a closed polygon — the solid icons (a bolt, a flame's body).
func (p pen) fill(nodes ...point) {
	b := newBrush(p.box())
	for i, node := range nodes {
		x, y := p.place(node)
		if i == 0 {
			b.moveTo(x, y)
		} else {
			b.lineTo(x, y)
		}
	}
	b.close()
	b.paint(p.dst, p.ink)
}

// kappa is the cubic control offset that turns four segments into a circle.
const kappa = 0.5522847498

// disc winds the same way stroke's segment quads do, so a joint adds to the
// segment it caps instead of cancelling a bite out of it.
func disc(b *brush, cx, cy, r float64) {
	k := r * kappa
	b.moveTo(cx, cy-r)
	b.cubeTo(cx-k, cy-r, cx-r, cy-k, cx-r, cy)
	b.cubeTo(cx-r, cy+k, cx-k, cy+r, cx, cy+r)
	b.cubeTo(cx+k, cy+r, cx+r, cy+k, cx+r, cy)
	b.cubeTo(cx+r, cy-k, cx+k, cy-r, cx, cy-r)
	b.close()
}

// holeOut is disc wound the other way, so it subtracts.
func holeOut(b *brush, cx, cy, r float64) {
	if r <= 0 {
		return
	}
	k := r * kappa
	b.moveTo(cx, cy-r)
	b.cubeTo(cx+k, cy-r, cx+r, cy-k, cx+r, cy)
	b.cubeTo(cx+r, cy+k, cx+k, cy+r, cx, cy+r)
	b.cubeTo(cx-k, cy+r, cx-r, cy+k, cx-r, cy)
	b.cubeTo(cx-r, cy-k, cx-k, cy-r, cx, cy-r)
	b.close()
}

// roundMask is a rounded rectangle as an alpha mask, in box-local
// coordinates — what lets something painted square be let through round.
func roundMask(box image.Rectangle, radius float64) *image.Alpha {
	local := image.Rect(0, 0, box.Dx(), box.Dy())
	mask := image.NewAlpha(local)
	b := newBrush(local)
	roundRect(b, local, radius)
	b.rast.Draw(mask, local, image.Opaque, image.Point{})
	return mask
}
