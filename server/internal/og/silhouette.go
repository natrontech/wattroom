package og

import (
	"image"
	"math"
	"slices"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"

	"github.com/natrontech/wattroom/server/internal/stats"
)

// The ride card's one big mark, its silhouette (#3142): a workout ride draws
// its watts, and a ride on a road draws the road it rode — the heights over
// the distance, each stretch painted with the zone the rider was in there.

// drawSilhouette picks the mark a ride has the data for.
func (s *Service) drawSilhouette(dst *image.NRGBA, box image.Rectangle, c RideCard) error {
	if onRoad(c) {
		s.drawRoad(dst, box, c)
		return nil
	}
	return s.drawTrace(dst, box, c)
}

// onRoad reports whether the card carries a road with somewhere to go on it:
// a metre and a height for every second, and a distance covered.
func onRoad(c RideCard) bool {
	n := len(c.Watts)
	return n >= 2 && len(c.Metres) == n && len(c.Heights) == n &&
		c.Metres[n-1] > c.Metres[0] && c.Ftp > 0
}

// minRoadSpanM keeps a flat road looking flat: a few metres of rise are not
// stretched to the full height of the box. A drawing constant, like the
// trace's 1.35 × FTP ceiling, not a product number.
const minRoadSpanM = 100

// drawRoad fills one column per horizontal pixel with the road's height
// there, capped in the zone the rider peaked in over that stretch — the
// trace's paint, on the road's shape. Drawn at 2× and scaled down, like the
// trace, so the profile is not a staircase.
func (s *Service) drawRoad(dst *image.NRGBA, box image.Rectangle, c RideCard) {
	const ss = 2
	w, h := box.Dx()*ss, box.Dy()*ss
	from, to := c.Metres[0], c.Metres[len(c.Metres)-1]
	heights := make([]float64, w)
	peaks := make([]int, w)
	i := 0
	for x := range w {
		end := from + (to-from)*float64(x+1)/float64(w)
		sum, n := 0.0, 0
		for ; i < len(c.Metres) && c.Metres[i] <= end; i++ {
			sum += c.Heights[i]
			n++
			peaks[x] = max(peaks[x], c.Watts[i])
		}
		switch {
		case n > 0:
			heights[x] = sum / float64(n)
		case x > 0:
			// A stretch no second landed in rides on at the last height.
			heights[x], peaks[x] = heights[x-1], peaks[x-1]
		default:
			heights[x] = c.Heights[0]
		}
	}
	lo, hi := slices.Min(heights), slices.Max(heights)
	span := math.Max(hi-lo, minRoadSpanM)
	tmp := image.NewNRGBA(image.Rect(0, 0, w, h))
	const capHeight = 5 * ss
	// A tenth of the box stays under the lowest point, so the valley floor is
	// still a road and not the panel's edge.
	floor := float64(h) * 0.1
	for x := range w {
		col := zoneInk[stats.PowerZone(peaks[x], c.Ftp)]
		y := max(0, int(float64(h)-floor-(heights[x]-lo)/span*(float64(h)-floor)))
		fill(tmp, image.Rect(x, y, x+1, min(y+capHeight, h)), col)
		for py := y + capHeight; py < h; py++ {
			body := col
			body.A = uint8(0xaa - 0x82*float64(py)/float64(h))
			tmp.SetNRGBA(x, py, body)
		}
	}
	draw.ApproxBiLinear.Scale(dst, box, tmp, tmp.Bounds(), draw.Over, nil)
}

// drawTrace fills one column per horizontal pixel, coloured by the zone that
// column peaked in: the shape of the ride and where it was hard, in one mark.
// Drawn at 2× and scaled down, because a hard-edged silhouette at 1× is a
// staircase.
func (s *Service) drawTrace(dst *image.NRGBA, box image.Rectangle, c RideCard) error {
	if len(c.Watts) < 2 || c.Ftp <= 0 {
		face, err := s.face(26)
		if err != nil {
			return err
		}
		drawCenter(dst, face, box.Min.X+box.Dx()/2, box.Min.Y+box.Dy()/2, muted,
			"No second-by-second record for this ride")
		return nil
	}
	const ss = 2
	w, h := box.Dx()*ss, box.Dy()*ss
	// Peak per column, like the web's trace: an average flattens the sprints
	// that are the point of looking at it.
	peaks := make([]int, w)
	for x := range peaks {
		from := len(c.Watts) * x / w
		to := max(from+1, len(c.Watts)*(x+1)/w)
		for _, v := range c.Watts[from:min(to, len(c.Watts))] {
			peaks[x] = max(peaks[x], v)
		}
	}
	// The ceiling is the ride's 99th column, not its highest: scaled to the
	// peak, one twelve-second sprint squashes an hour of riding into the
	// bottom third of the box and the card is mostly empty. The few columns
	// above it clip, and the true peak is printed under the trace as the
	// best 5 s — so nothing is hidden, it is just not given the whole axis.
	// Three columns wide, because the buckets alias: 4 000 samples across
	// 1 760 columns means neighbouring columns cover two samples and three by
	// turns, and drawing that raw combs the whole trace with a stripe the ride
	// never rode.
	smooth := make([]int, len(peaks))
	for x := range peaks {
		sum, n := 0, 0
		for i := max(0, x-1); i <= min(len(peaks)-1, x+1); i++ {
			sum += peaks[i]
			n++
		}
		smooth[x] = sum / n
	}
	peaks = smooth
	ranked := slices.Sorted(slices.Values(peaks))
	top := math.Max(float64(c.Ftp)*1.35, float64(ranked[len(ranked)*99/100]))

	tmp := image.NewNRGBA(image.Rect(0, 0, w, h))
	const capHeight = 5 * ss
	// One gradient down the whole box rather than one per column: faded from
	// each column's own cap, a short column and a tall one reached the floor
	// at different opacities and the recovery stretches grew vertical stripes.
	shade := make([]uint8, h)
	for py := range shade {
		shade[py] = uint8(0xaa - 0x82*float64(py)/float64(h))
	}
	for x, peak := range peaks {
		col := zoneInk[stats.PowerZone(peak, c.Ftp)]
		y := max(0, h-int(float64(peak)/top*float64(h)))
		// The cap carries the zone's colour and the area under it fades out of
		// it, so the trace has a lit edge instead of a flat block of paint.
		fill(tmp, image.Rect(x, y, x+1, min(y+capHeight, h)), col)
		for py := y + capHeight; py < h; py++ {
			body := col
			body.A = shade[py]
			tmp.SetNRGBA(x, py, body)
		}
	}
	// ApproxBiLinear, not CatmullRom: a cubic kernel rings on an edge this
	// hard and hangs a halo over the silhouette.
	draw.ApproxBiLinear.Scale(dst, box, tmp, tmp.Bounds(), draw.Over, nil)

	// The FTP line is a reference, so it is structural neon and dashed —
	// nothing about it is live data (ADR-0005).
	y := box.Max.Y - int(float64(c.Ftp)/top*float64(box.Dy()))
	for x := box.Min.X; x < box.Max.X; x += 22 {
		fill(dst, image.Rect(x, y, min(x+12, box.Max.X), y+2), neon)
	}
	face, err := s.face(22)
	if err != nil {
		return err
	}
	// On its own backing: the line lands wherever the ride's ceiling puts it,
	// which is regularly on top of the trace.
	label := "FTP " + watts(c.Ftp)
	width := font.MeasureString(face, label).Ceil()
	fill(dst, image.Rect(box.Max.X-width-12, y-34, box.Max.X, y-4), surfaceRaised)
	drawRight(dst, face, box.Max.X, y-12, muted, label)
	return nil
}
