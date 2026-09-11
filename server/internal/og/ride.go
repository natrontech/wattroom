package og

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strconv"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/stats"
	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
)

// The ride card (#2112). Strava's API uploads an activity and never a photo
// for it, so the only way a WattRoom ride gets a picture on Strava is the
// rider saving one and adding it themselves — which means we owe them a
// picture worth adding. Square, because a feed crops everything else.
//
// Drawn here rather than on a canvas in the browser: the face is embedded in
// this package, the PNG pipeline and the logo are written, and the samples
// are already on the server.

const (
	cardSize   = 1080
	cardMargin = 72
	cardRight  = cardSize - cardMargin
	cardWidth  = cardSize - 2*cardMargin
)

// The Coggan ramp's dark half, from web/src/app.css — zone colour is learned
// and read across a room, so it is the one thing a theme never rotates
// (ADR-0023 §4). Index 1–7; 0 is unused, like the web's arrays.
var zoneInk = [8]color.NRGBA{
	{},
	{0x4a, 0x3a, 0x78, 0xff},
	{0x43, 0x61, 0xee, 0xff},
	{0x00, 0xb4, 0xd8, 0xff},
	{0x06, 0xd6, 0xa0, 0xff},
	{0xff, 0xa6, 0x2b, 0xff},
	{0xff, 0x4d, 0x6d, 0xff},
	{0xff, 0x2e, 0x88, 0xff},
}

var (
	surfaceRaised = color.NRGBA{0x1a, 0x07, 0x36, 0xff}
	// app.css draws the line around a raised thing as ink at a twelfth.
	edge = color.NRGBA{0xff, 0xff, 0xff, 0x20}
)

// RideCard is one finished ride, as the card draws it. Every number is
// computed where it belongs and handed over — this file draws, it does not
// score.
type RideCard struct {
	WorkoutName string
	StartedAt   time.Time
	// RoomName is empty for a solo ride.
	RoomName  string
	Seconds   int
	AvgWatts  int
	NormWatts int
	Kj        int
	Ftp       int
	Xp        int
	Execution float64
	// ExecutionScored is false when the workout prescribed nothing to score
	// (#1143) — the cell says so rather than printing a meaningless 0 %.
	ExecutionScored bool
	Curve           stats.Curve
	// Watts is the per-second series. A ride whose blob could not be read
	// still gets a card; it just has no trace.
	Watts []int
}

// RenderRide draws the 1080×1080 card as a PNG.
func RenderRide(c RideCard) ([]byte, error) {
	fnt, err := opentype.Parse(fontTTF)
	if err != nil {
		return nil, err
	}
	// face and fit are the Service's, and a card wants the face and the
	// fitting without the room lookup or the preview cache.
	s := &Service{fnt: fnt}

	img := image.NewNRGBA(image.Rect(0, 0, cardSize, cardSize))
	fill(img, img.Bounds(), surface)

	drawLogo(img, cardMargin, 48, 56)
	wordFace, err := s.face(34)
	if err != nil {
		return nil, err
	}
	drawText(img, wordFace, cardMargin+72, 104, ink, siteName)
	drawRight(img, wordFace, cardRight, 104, muted, c.StartedAt.Format("2 Jan 2006 · 15:04"))

	titleFace, title, err := s.fit(c.WorkoutName, cardWidth, 84, 46)
	if err != nil {
		return nil, err
	}
	drawText(img, titleFace, cardMargin, 220, ink, title)

	where := "solo ride"
	if c.RoomName != "" {
		where = "in " + c.RoomName
	}
	subFace, sub, err := s.fit(clock(c.Seconds)+" · "+where, cardWidth, 32, 22)
	if err != nil {
		return nil, err
	}
	drawText(img, subFace, cardMargin, 266, muted, sub)

	fill(img, image.Rect(cardMargin, 300, cardRight, 700), surfaceRaised)
	traceBox := image.Rect(cardMargin+32, 332, cardRight-32, 596)
	if err := s.drawTrace(img, traceBox, c); err != nil {
		return nil, err
	}
	if err := s.drawZoneBar(img, image.Rect(cardMargin+32, 620, cardRight-32, 648), c); err != nil {
		return nil, err
	}

	execution := "not scored"
	if c.ExecutionScored {
		execution = strconv.Itoa(int(c.Execution*100+0.5)) + " %"
	}
	if err := s.drawCells(img, 770, 806, 60, 24, [][2]string{
		{"average", strconv.Itoa(c.AvgWatts) + " W"},
		{"normalised", strconv.Itoa(c.NormWatts) + " W"},
		{"work", group(c.Kj) + " kJ"},
		{"execution", execution},
	}); err != nil {
		return nil, err
	}

	fill(img, image.Rect(cardMargin, 848, cardRight, 849), edge)
	if err := s.drawCells(img, 908, 942, 38, 22, [][2]string{
		{"best 5 s", watts(c.Curve.Best5s)},
		{"best 1 min", watts(c.Curve.Best1m)},
		{"best 5 min", watts(c.Curve.Best5m)},
		{"best 20 min", watts(c.Curve.Best20m)},
	}); err != nil {
		return nil, err
	}

	footFace, err := s.face(26)
	if err != nil {
		return nil, err
	}
	// Not a domain: a self-hosted instance is not wattroom.ch, and this line
	// is the one a rider's Strava caption gets for free.
	drawText(img, footFace, cardMargin, 1008, muted, "Ridden on "+siteName)
	drawRight(img, footFace, cardRight, 1008, ink, group(c.Xp)+" XP")

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
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
	top := float64(c.Ftp) * 1.2
	for x := range peaks {
		from := len(c.Watts) * x / w
		to := max(from+1, len(c.Watts)*(x+1)/w)
		for _, v := range c.Watts[from:min(to, len(c.Watts))] {
			peaks[x] = max(peaks[x], v)
		}
		top = max(top, float64(peaks[x]))
	}

	tmp := image.NewNRGBA(image.Rect(0, 0, w, h))
	const capHeight = 5 * ss
	for x, peak := range peaks {
		col := zoneInk[stats.PowerZone(peak, c.Ftp)]
		y := h - int(float64(peak)/top*float64(h))
		body := col
		body.A = 0x6e // the area reads as a tint; the cap carries the colour
		fill(tmp, image.Rect(x, y+capHeight, x+1, h), body)
		fill(tmp, image.Rect(x, y, x+1, min(y+capHeight, h)), col)
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

// drawZoneBar is where the time went: one band per zone, widths in proportion
// to seconds ridden in it, labelled where a band is wide enough to read.
func (s *Service) drawZoneBar(dst *image.NRGBA, box image.Rectangle, c RideCard) error {
	var seconds [8]int
	total := 0
	for _, v := range c.Watts {
		if v <= 0 {
			continue // coasting belongs to no zone, the way the web counts it
		}
		seconds[stats.PowerZone(v, c.Ftp)]++
		total++
	}
	if total == 0 {
		return nil
	}
	face, err := s.face(22)
	if err != nil {
		return err
	}
	x := box.Min.X
	for zone := 1; zone <= 7; zone++ {
		if seconds[zone] == 0 {
			continue
		}
		// Last band takes the rounding, so the bar ends exactly on the box.
		end := x + box.Dx()*seconds[zone]/total
		if zone == lastZone(seconds) {
			end = box.Max.X
		}
		fill(dst, image.Rect(x, box.Min.Y, end, box.Max.Y), zoneInk[zone])
		if end-x >= 110 {
			drawCenter(dst, face, (x+end)/2, box.Max.Y+32, muted,
				"Z"+strconv.Itoa(zone)+" "+clock(seconds[zone]))
		}
		x = end
	}
	return nil
}

func lastZone(seconds [8]int) int {
	last := 0
	for zone := 1; zone <= 7; zone++ {
		if seconds[zone] > 0 {
			last = zone
		}
	}
	return last
}

// drawCells lays out evenly spaced value-over-label columns across the card.
// Each value is fitted to its own column: "not scored" at the headline size
// ran off the edge of the card (#2112), and a five-digit kJ would too.
func (s *Service) drawCells(dst *image.NRGBA, valueY, labelY int, valueSize, labelSize float64, cells [][2]string) error {
	labelFace, err := s.face(labelSize)
	if err != nil {
		return err
	}
	step := cardWidth / len(cells)
	for i, cell := range cells {
		x := cardMargin + i*step
		valueFace, value, err := s.fit(cell[1], step-16, valueSize, labelSize)
		if err != nil {
			return err
		}
		drawText(dst, valueFace, x, valueY, ink, value)
		drawText(dst, labelFace, x, labelY, muted, cell[0])
	}
	return nil
}

func fill(dst *image.NRGBA, r image.Rectangle, c color.NRGBA) {
	op := draw.Src
	if c.A < 0xff {
		op = draw.Over
	}
	draw.Draw(dst, r, image.NewUniform(c), image.Point{}, op)
}

func drawRight(dst *image.NRGBA, f font.Face, xRight, y int, c color.NRGBA, text string) {
	drawText(dst, f, xRight-font.MeasureString(f, text).Ceil(), y, c, text)
}

func drawCenter(dst *image.NRGBA, f font.Face, xMid, y int, c color.NRGBA, text string) {
	drawText(dst, f, xMid-font.MeasureString(f, text).Ceil()/2, y, c, text)
}

// watts prints a curve window a short ride never reached as a dash, not 0 W.
func watts(w int) string {
	if w <= 0 {
		return "—"
	}
	return group(w) + " W"
}

// clock is h:mm:ss, dropping the hour when there isn't one.
func clock(seconds int) string {
	if seconds >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", seconds/3600, seconds/60%60, seconds%60)
	}
	return fmt.Sprintf("%d:%02d", seconds/60, seconds%60)
}

// group thins thousands apart — "1 240", not "1240", at card sizes.
func group(n int) string {
	digits := strconv.Itoa(n)
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte(' ')
		}
		b.WriteRune(r)
	}
	return b.String()
}
