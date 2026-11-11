package og

import (
	"image"
	"image/color"
	"math"
	"slices"
	"strconv"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"

	"github.com/natrontech/wattroom/server/internal/stats"
)

// The workout's picture (#4430): in a workout the workout is the picture —
// its blocks, the watts ridden over them (and a heart rate when handed one) —
// the way the riding screen draws a workout along its bottom, never the
// road's gradient. A workout on a road says the road in words under its
// title, and draws none of it.

// hasTargets says the card carries a workout's blocks to draw: a target for
// every second, and at least one that asks for watts.
func hasTargets(c RideCard) bool {
	return len(c.Targets) == len(c.Watts) && slices.ContainsFunc(c.Targets, func(t float64) bool { return t > 0 })
}

// columns is one value per horizontal pixel of a w-wide drawing over n
// seconds: the mean of the seconds that column covers and `at` has a value
// for, or -1 where it has none.
func columns(w, n int, at func(i int) (float64, bool)) []float64 {
	out := make([]float64, w)
	for x := range out {
		from := n * x / w
		to := max(from+1, n*(x+1)/w)
		sum, k := 0.0, 0
		for i := from; i < min(to, n); i++ {
			if v, ok := at(i); ok {
				sum += v
				k++
			}
		}
		out[x] = -1
		if k > 0 {
			out[x] = sum / float64(k)
		}
	}
	return out
}

// smoothed is a line's columns averaged over a few neighbours: a second's
// wobble is not what a picture of an hour is about. Gaps stay gaps.
func smoothed(cols []float64, radius int) []float64 {
	out := make([]float64, len(cols))
	for x := range cols {
		if cols[x] < 0 {
			out[x] = -1
			continue
		}
		sum, k := 0.0, 0
		for i := max(0, x-radius); i <= min(len(cols)-1, x+radius); i++ {
			if cols[i] >= 0 {
				sum += cols[i]
				k++
			}
		}
		out[x] = sum / float64(k)
	}
	return out
}

// polyline joins one y per column into a line `thick` pixels deep: each
// column spans from its own y to its neighbour's, so a steep step stays
// joined. A y below 0 is a gap.
func polyline(dst *image.NRGBA, ys []float64, thick int, col color.NRGBA) {
	for x, y := range ys {
		if y < 0 {
			continue
		}
		lo, hi := y, y
		if x+1 < len(ys) && ys[x+1] >= 0 {
			lo, hi = math.Min(lo, ys[x+1]), math.Max(hi, ys[x+1])
		}
		fill(dst, image.Rect(x, int(lo)-thick/2, x+1, int(hi)+thick-thick/2), col)
	}
}

// drawWorkout is the workout's blocks, each in its zone's colour up to its
// target, with the watts ridden over them as one line. It answers the watts
// at the top of the box, for the lines drawn over it, and 0 when it drew
// nothing.
func (s *Service) drawWorkout(dst *image.NRGBA, box image.Rectangle, c RideCard) (float64, error) {
	if len(c.Watts) < 2 || c.Ftp <= 0 {
		return 0, s.noRecord(dst, box)
	}
	const ss = 2
	w, h := box.Dx()*ss, box.Dy()*ss
	n := len(c.Watts)
	targets := columns(w, n, func(i int) (float64, bool) { return c.Targets[i], true })
	power := smoothed(columns(w, n, func(i int) (float64, bool) { return float64(c.Watts[i]), true }), 3*ss)

	// Scaled to the workout, not to 1.35 × FTP: a sweet-spot hour left the
	// top third of the box empty. FTP stays in view, with room for its label.
	ranked := slices.Sorted(slices.Values(power))
	top := math.Max(float64(c.Ftp)*1.12, math.Max(ranked[len(ranked)*99/100]*1.05, slices.Max(targets)*1.15))
	y := func(watts float64) float64 { return float64(h) - watts/top*float64(h) }

	tmp := image.NewNRGBA(image.Rect(0, 0, w, h))
	const capHeight = 4 * ss
	for x, target := range targets {
		if target <= 0 {
			continue
		}
		col := zoneInk[stats.PowerZone(int(target+0.5), c.Ftp)]
		top := max(0, int(y(target)))
		// The block's own face, quiet, under a lit top edge: the riding
		// screen's blocks, so the watts line reads over them.
		body := col
		body.A = 0x66
		fill(tmp, image.Rect(x, top, x+1, h), body)
		fill(tmp, image.Rect(x, top, x+1, min(top+capHeight, h)), col)
	}
	line := make([]float64, len(power))
	for x, watts := range power {
		line[x] = math.Max(0, y(watts))
	}
	// Ink, not watt: the riding screen's trace is ink over its blocks, and
	// the heart rate is the line that wears the live colour here.
	ink := s.pal.ink
	ink.A = 0xe6
	polyline(tmp, line, 3*ss, ink)
	draw.ApproxBiLinear.Scale(dst, box, tmp, tmp.Bounds(), draw.Over, nil)
	return top, nil
}

// drawHeartRate lays the ride's heart rate over the watts on its own scale,
// lowest to highest beat of the ride, in the live colour. Seconds with no
// reading leave the line open rather than drawing it down to zero.
func (s *Service) drawHeartRate(dst *image.NRGBA, box image.Rectangle, c RideCard) error {
	if len(c.HR) != len(c.Watts) || !slices.ContainsFunc(c.HR, func(v int) bool { return v > 0 }) {
		return nil
	}
	const ss = 2
	w, h := box.Dx()*ss, box.Dy()*ss
	beats := smoothed(columns(w, len(c.HR), func(i int) (float64, bool) {
		return float64(c.HR[i]), c.HR[i] > 0
	}), 3*ss)
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, v := range beats {
		if v >= 0 {
			lo, hi = math.Min(lo, v), math.Max(hi, v)
		}
	}
	// Ten beats at least, so a steady ride's heart rate is a steady line and
	// not its noise blown up to the whole box.
	span := math.Max(hi-lo, 10)
	line := make([]float64, len(beats))
	for x, v := range beats {
		line[x] = -1
		if v >= 0 {
			// The top tenth and the bottom fifth stay clear: the line rides
			// over the watts, not along the box's edges.
			line[x] = float64(h) * (0.1 + 0.7*(1-(v-lo)/span))
		}
	}
	tmp := image.NewNRGBA(image.Rect(0, 0, w, h))
	polyline(tmp, line, 3*ss, s.pal.watt)
	draw.ApproxBiLinear.Scale(dst, box, tmp, tmp.Bounds(), draw.Over, nil)
	return nil
}

// legendItem is one mark's swatch and what it is. A swatch of several
// colours is the blocks, which wear their zones.
type legendItem struct {
	cols []color.NRGBA
	text string
}

// legend says what the lines over a workout are, along the top of its
// panel: blocks, watts and the heart rate are three marks in one box, and a
// glance has to tell which is which.
func (s *Service) legend(c RideCard) []legendItem {
	var items []legendItem
	if hasTargets(c) {
		items = append(items, legendItem{[]color.NRGBA{zoneInk[2], zoneInk[3], zoneInk[5]}, "workout"},
			legendItem{[]color.NRGBA{s.pal.ink}, "power"})
	}
	if c.AvgHR > 0 && slices.ContainsFunc(c.HR, func(v int) bool { return v > 0 }) {
		items = append(items, legendItem{[]color.NRGBA{s.pal.watt}, "heart rate · " + strconv.Itoa(c.AvgHR) + " bpm avg"})
	}
	return items
}

func (s *Service) drawLegend(dst *image.NRGBA, x, baseline int, items []legendItem) error {
	if len(items) == 0 {
		return nil
	}
	face, err := s.face(20)
	if err != nil {
		return err
	}
	for _, item := range items {
		const swatch = 24
		step := swatch / len(item.cols)
		for i, col := range item.cols {
			fill(dst, image.Rect(x+i*step, baseline-10, x+(i+1)*step, baseline-4), col)
		}
		x += swatch + 8
		drawText(dst, face, x, baseline, s.pal.muted, item.text)
		x += font.MeasureString(face, item.text).Ceil() + 28
	}
	return nil
}
