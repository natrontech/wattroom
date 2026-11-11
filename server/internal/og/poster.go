package og

import (
	"image"
	"image/color"
	"math"
	"slices"
	"strconv"

	"golang.org/x/image/draw"
)

// The poster: a free ride on a road (#3142), drawn as one graph — the road
// it rode as a quiet silhouette in the lower part, and the rider's power as
// one ink line over it — so a glance reads the watts going up the hills. No
// workout asked for anything, so nothing is scored and the tiles say the
// road instead: how far, how much it climbed.

// posterBox is the poster's graph, over the zone bar.
var (
	posterBox        = image.Rect(cardMargin+36, 330, cardRight-36, 744)
	posterZoneBarBox = image.Rect(cardMargin+36, 762, cardRight-36, 784)
)

// posterAverageSeconds is the poster's power line: a 30 s rolling average.
// A second's wobble across an hour of rolling road is a scribble that hides
// the hills; half a minute keeps a climb's effort and drops the noise. A
// drawing constant, like the trace's ceiling, not a product number.
const posterAverageSeconds = 30

// drawPosterCard is the poster's panel and numbers: the graph, the zone bar,
// one row of six tiles, the curve, and the credit for the road's heights.
func (s *Service) drawPosterCard(img *image.NRGBA, c RideCard) error {
	fillRound(img, workoutPanel, 28, s.pal.raised)
	s.drawProfile(img, posterBox, c)
	top := s.drawPowerOver(img, posterBox, c)
	if err := s.drawFTPLine(img, posterBox, c.Ftp, top); err != nil {
		return err
	}
	ink, road := s.pal.ink, s.pal.muted
	if err := s.drawLegend(img, posterBox.Min.X, posterBox.Min.Y-12, []legendItem{
		{cols: []color.NRGBA{ink}, text: "power · 30 s average"},
		{cols: []color.NRGBA{road}, text: "road"},
	}); err != nil {
		return err
	}
	if err := s.drawZoneBar(img, posterZoneBarBox, c); err != nil {
		return err
	}
	if err := s.drawTileRow(img, 870, []tile{
		{iconClock, clock(c.Seconds), "duration"},
		{iconMoveHorizontal, strconv.FormatFloat(c.RoadM/1000, 'f', 1, 64) + " km", "distance"},
		{iconMountain, group(int(c.ClimbM+0.5)) + " m", "climbed"},
		{iconZap, strconv.Itoa(c.AvgWatts) + " W", "average"},
		{iconActivity, strconv.Itoa(c.NormWatts) + " W", "normalised"},
		{iconFlame, group(c.Kj) + " kJ", "work"},
	}); err != nil {
		return err
	}
	curveAt := 1040
	if c.HeightCredit != "" {
		curveAt = 1026
	}
	if err := s.drawCurve(img, curveAt, c.Curve); err != nil {
		return err
	}
	if c.HeightCredit != "" {
		face, err := s.face(18)
		if err != nil {
			return err
		}
		drawCenter(img, face, cardSize/2, 1060, s.pal.mutedDim, c.HeightCredit)
	}
	return nil
}

// rollingAverage is each second's mean over the `window` seconds centred on
// it, fewer at the ride's ends: centred, so a climb's effort sits over the
// climb rather than trailing it.
func rollingAverage(watts []int, window int) []float64 {
	out := make([]float64, len(watts))
	sum := make([]int, len(watts)+1)
	for i, w := range watts {
		sum[i+1] = sum[i] + w
	}
	for i := range watts {
		from := max(0, i-window/2)
		to := min(len(watts), from+window)
		from = max(0, to-window)
		out[i] = float64(sum[to]-sum[from]) / float64(to-from)
	}
	return out
}

// drawProfile is the road over the ride's seconds, on the same clock as the
// power over it: a muted silhouette in the lower three fifths of the box,
// its edge a shade firmer than its body. Seconds before the road (M 0) are
// not on it, and a column none of them landed in rides on at the last height.
func (s *Service) drawProfile(dst *image.NRGBA, box image.Rectangle, c RideCard) {
	const ss = 2
	w, h := box.Dx()*ss, box.Dy()*ss
	heights := columns(w, len(c.Heights), func(i int) (float64, bool) {
		return c.Heights[i], c.Metres[i] > 0
	})
	lo, hi := math.Inf(1), math.Inf(-1)
	last := -1.0
	for x, v := range heights {
		if v < 0 {
			heights[x] = last
			continue
		}
		last = v
		lo, hi = math.Min(lo, v), math.Max(hi, v)
	}
	if math.IsInf(lo, 1) {
		return
	}
	span := math.Max(hi-lo, minRoadSpanM)
	tmp := image.NewNRGBA(image.Rect(0, 0, w, h))
	const edgeHeight = 2 * ss
	edge := s.pal.muted
	edge.A = 0x90
	for x, v := range heights {
		if v < 0 {
			continue
		}
		// A sixteenth of the box under the valley floor, the climb in the
		// three fifths above it, and the top left to the watts.
		y := int(float64(h) - float64(h)/16 - (v-lo)/span*float64(h)*0.6)
		fill(tmp, image.Rect(x, y, x+1, min(y+edgeHeight, h)), edge)
		for py := y + edgeHeight; py < h; py++ {
			body := s.pal.muted
			body.A = uint8(0x48 - 0x30*float64(py)/float64(h))
			tmp.SetNRGBA(x, py, body)
		}
	}
	draw.ApproxBiLinear.Scale(dst, box, tmp, tmp.Bounds(), draw.Over, nil)
}

// drawPowerOver is the 30 s average as one ink line, about 3 px at the
// card's size, over a dark halo that keeps it legible where it crosses the
// road's edge. Its scale is its own, FTP in view; it answers the watts at
// the top of the box for the FTP line.
func (s *Service) drawPowerOver(dst *image.NRGBA, box image.Rectangle, c RideCard) float64 {
	if len(c.Watts) < 2 || c.Ftp <= 0 {
		return 0
	}
	const ss = 2
	w, h := box.Dx()*ss, box.Dy()*ss
	averaged := rollingAverage(c.Watts, posterAverageSeconds)
	power := columns(w, len(averaged), func(i int) (float64, bool) { return averaged[i], true })
	ranked := slices.Sorted(slices.Values(power))
	top := math.Max(float64(c.Ftp)*1.2, ranked[len(ranked)*99/100]*1.08)
	line := make([]float64, len(power))
	for x, watts := range power {
		line[x] = math.Max(0, float64(h)-watts/top*float64(h))
	}
	tmp := image.NewNRGBA(image.Rect(0, 0, w, h))
	halo := s.pal.surface
	halo.A = 0x99
	polyline(tmp, line, 7*ss, halo)
	polyline(tmp, line, 3*ss, s.pal.ink)
	draw.ApproxBiLinear.Scale(dst, box, tmp, tmp.Bounds(), draw.Over, nil)
	return top
}
