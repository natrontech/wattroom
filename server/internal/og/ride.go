package og

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/natrontech/wattroom/server/internal/stats"
	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/font/sfnt"
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
	// app.css's second step of the text ramp: the quietest a theme may draw.
	mutedDim = color.NRGBA{0x85, 0x76, 0xab, 0xff}
	// `neon` lifted towards ink: a 2-unit stroke at 30 px is a tenth of the
	// paint a text glyph is, and the structural hue alone disappeared into the
	// tile it sits on. Still chrome, still glow-free (ADR-0005).
	iconInk = lerp(neon, ink, 0.34)
	// The top of the card's ground. Not a token: it is `surface` lifted
	// towards `surface-raised`, so the page has a sky rather than a flat wall.
	skyTop = color.NRGBA{0x14, 0x05, 0x2c, 0xff}
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

// embeddedFace parses the build-time asset once. A card is drawn per request
// and has no Service to hold the parsed font for it.
var embeddedFace = sync.OnceValues(func() (*sfnt.Font, error) {
	return opentype.Parse(fontTTF)
})

// The two marks inside the ride panel, named so the test that checks they are
// actually drawn cannot drift away from where they are drawn.
var (
	traceBox   = image.Rect(cardMargin+36, 320, cardRight-36, 556)
	zoneBarBox = image.Rect(cardMargin+36, 578, cardRight-36, 602)
)

// RenderRide draws the 1080×1080 card as a PNG.
func RenderRide(c RideCard) ([]byte, error) {
	fnt, err := embeddedFace()
	if err != nil {
		return nil, err
	}
	// face and fit are the Service's, and a card wants the face and the
	// fitting without the room lookup or the preview cache.
	s := &Service{fnt: fnt}
	img := image.NewNRGBA(image.Rect(0, 0, cardSize, cardSize))
	skyFill(img)

	drawLogo(img, cardMargin, 48, 52)
	wordFace, err := s.face(32)
	if err != nil {
		return nil, err
	}
	drawText(img, wordFace, cardMargin+68, 90, ink, siteName)
	if err := s.datePill(img, c.StartedAt.Format("2 Jan 2006 · 15:04")); err != nil {
		return nil, err
	}

	titleFace, title, err := s.fit(c.WorkoutName, cardWidth, 80, 44)
	if err != nil {
		return nil, err
	}
	drawText(img, titleFace, cardMargin, 190, ink, title)
	// The logo's own watt→neon gradient, as the card's one rule: data hue into
	// chrome hue, the way the bars above it climb (ADR-0005).
	gradientBar(img, image.Rect(cardMargin, 206, cardMargin+160, 212))

	where := "Solo ride"
	if c.RoomName != "" {
		where = "in " + c.RoomName
	}
	subFace, sub, err := s.fit(where, cardWidth, 30, 22)
	if err != nil {
		return nil, err
	}
	drawText(img, subFace, cardMargin, 258, muted, sub)

	fillRound(img, image.Rect(cardMargin, 286, cardRight, 660), 28, surfaceRaised)
	if err := s.drawTrace(img, traceBox, c); err != nil {
		return nil, err
	}
	if err := s.drawZoneBar(img, zoneBarBox, c); err != nil {
		return nil, err
	}

	execution := "not scored"
	if c.ExecutionScored {
		execution = strconv.Itoa(int(c.Execution*100+0.5)) + " %"
	}
	for row, tiles := range [2][3]tile{
		{
			{iconClock, clock(c.Seconds), "duration"},
			{iconZap, strconv.Itoa(c.AvgWatts) + " W", "average"},
			{iconFlame, group(c.Kj) + " kJ", "work"},
		},
		{
			{iconActivity, strconv.Itoa(c.NormWatts) + " W", "normalised"},
			{iconTarget, execution, "execution"},
			{iconTrophy, group(c.Xp) + " XP", "earned"},
		},
	} {
		if err := s.drawTiles(img, 684+row*144, tiles); err != nil {
			return nil, err
		}
	}

	if err := s.drawCurve(img, 1004, c.Curve); err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// skyFill is the card's ground: the surface, lifted a little at the top so
// the title has something behind it and the numbers sink into the dark.
func skyFill(dst *image.NRGBA) {
	for y := 0; y < cardSize; y++ {
		fill(dst, image.Rect(0, y, cardSize, y+1), lerp(skyTop, surface, float64(y)/cardSize))
	}
}

func gradientBar(dst *image.NRGBA, box image.Rectangle) {
	for x := box.Min.X; x < box.Max.X; x++ {
		at := float64(x-box.Min.X) / float64(box.Dx())
		fill(dst, image.Rect(x, box.Min.Y, x+1, box.Max.Y), lerp(watt, neon, at))
	}
}

// datePill sets the date apart from the wordmark it shares a line with.
func (s *Service) datePill(dst *image.NRGBA, when string) error {
	face, err := s.face(24)
	if err != nil {
		return err
	}
	width := font.MeasureString(face, when).Ceil()
	box := image.Rect(cardRight-width-36, 52, cardRight, 96)
	fillRound(dst, box, 22, surfaceRaised)
	drawText(dst, face, box.Min.X+18, 82, muted, when)
	return nil
}

// tile is one number with the icon that says what it is.
type tile struct {
	mark  icon
	value string
	label string
}

// drawTiles lays a row of three across the card. Each value is fitted to its
// own tile: "not scored" at the headline size ran off the edge of the card,
// and a five-digit kJ would too.
func (s *Service) drawTiles(dst *image.NRGBA, top int, tiles [3]tile) error {
	labelFace, err := s.face(21)
	if err != nil {
		return err
	}
	step := cardWidth / len(tiles)
	for i, t := range tiles {
		box := image.Rect(cardMargin+i*step, top, cardMargin+i*step+step-16, top+128)
		fillRound(dst, box, 20, surfaceRaised)
		t.mark.draw(dst, float64(box.Min.X+24), float64(top+18), 34, iconInk)
		valueFace, value, err := s.fit(t.value, box.Dx()-48, 46, 21)
		if err != nil {
			return err
		}
		drawText(dst, valueFace, box.Min.X+24, top+96, ink, value)
		drawText(dst, labelFace, box.Min.X+24, top+120, muted, t.label)
	}
	return nil
}

// drawCurve is the small print: the four SPEC windows on one centred line,
// labels quiet and numbers not, with the windows a short ride never reached
// still named rather than dropped.
func (s *Service) drawCurve(dst *image.NRGBA, baseline int, curve stats.Curve) error {
	labelFace, err := s.face(22)
	if err != nil {
		return err
	}
	valueFace, err := s.face(26)
	if err != nil {
		return err
	}
	parts := [][2]string{
		{"5 s", watts(curve.Best5s)},
		{"1 min", watts(curve.Best1m)},
		{"5 min", watts(curve.Best5m)},
		{"20 min", watts(curve.Best20m)},
	}
	width := 0
	for i, part := range parts {
		width += font.MeasureString(labelFace, part[0]+" ").Ceil()
		width += font.MeasureString(valueFace, part[1]).Ceil()
		if i < len(parts)-1 {
			width += font.MeasureString(labelFace, "   ·   ").Ceil()
		}
	}
	x := cardMargin + (cardWidth-width)/2
	for i, part := range parts {
		drawText(dst, labelFace, x, baseline, mutedDim, part[0]+" ")
		x += font.MeasureString(labelFace, part[0]+" ").Ceil()
		drawText(dst, valueFace, x, baseline, ink, part[1])
		x += font.MeasureString(valueFace, part[1]).Ceil()
		if i < len(parts)-1 {
			drawText(dst, labelFace, x, baseline, mutedDim, "   ·   ")
			x += font.MeasureString(labelFace, "   ·   ").Ceil()
		}
	}
	return nil
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
	// Painted into its own image and let through a rounded mask, so the bar is
	// a pill rather than a brick — the bands each end square inside it.
	bands := image.NewNRGBA(image.Rect(0, 0, box.Dx(), box.Dy()))
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
		fill(bands, image.Rect(x-box.Min.X, 0, end-box.Min.X, box.Dy()), zoneInk[zone])
		if end-x >= 110 {
			drawCenter(dst, face, (x+end)/2, box.Max.Y+32, muted,
				"Z"+strconv.Itoa(zone)+" "+clock(seconds[zone]))
		}
		x = end
	}
	draw.DrawMask(dst, box, bands, image.Point{}, roundMask(box, float64(box.Dy())/2), image.Point{}, draw.Over)
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
