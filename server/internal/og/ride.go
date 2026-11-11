package og

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
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

// RideCard is one finished ride, as the card draws it. Every number is
// computed where it belongs and handed over — this file draws, it does not
// score.
type RideCard struct {
	WorkoutName string
	StartedAt   time.Time
	// Where it was ridden — the voice channel, else the crew; empty for a
	// solo ride.
	Place     string
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
	// The workout's target at each second in watts, beside Watts (#4430):
	// the blocks the ride was ridden to, 0 where the workout asked for no
	// watts. Nil on a ride with no workout, which draws its watts alone.
	Targets []float64
	// Heart rate at each second, beside Watts; 0 where none was read. AvgHR
	// is the ride's, over the seconds that had one.
	HR    []int
	AvgHR int
	// On a road (#3142): each second's metres along it and height there,
	// beside Watts. With them a free ride's card is a poster — its power
	// over the road it rode.
	Metres, Heights []float64
	// What a poster's tiles say of the road: the metres ridden and the
	// climb over them, as the ride's page counts them.
	RoadM, ClimbM float64
	// Workout says the ride was ridden to a workout (ADR-0062's mode). A
	// workout is drawn as the workout, on a road or off one, and nothing of
	// the road's shape: the workout fills the card (#4430).
	Workout bool
	// RoadLine is where a workout on a road was ridden, in numbers only
	// ("Virtual route · 32.0 km · 410 m"), said after the place under the
	// title. Empty off a road, and where the title already says the road.
	RoadLine string
	// Where the road's heights came from, printed small at the foot of a
	// poster: data that is someone else's is credited where it shows (#3133).
	HeightCredit string
	// The rider's appearance (#4098); the zero value draws Outrun's dark half.
	Theme Palette
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

// A workout's card gives the panel to the workout: one tall graph, the
// numbers in a single row of six under it.
var (
	workoutPanel = image.Rect(cardMargin, 286, cardRight, 846)
	workoutBox   = image.Rect(cardMargin+36, 330, cardRight-36, 818)
)

// RenderRide draws the 1080×1080 card as a PNG.
func RenderRide(c RideCard) ([]byte, error) {
	fnt, err := embeddedFace()
	if err != nil {
		return nil, err
	}
	// face and fit are the Service's, and a card wants the face and the
	// fitting without the room lookup or the preview cache.
	s := &Service{fnt: fnt, pal: c.Theme.orDefault()}
	img := image.NewNRGBA(image.Rect(0, 0, cardSize, cardSize))
	skyFill(img, s.pal)

	if err := s.drawBrand(img); err != nil {
		return nil, err
	}

	titleFace, title, err := s.fit(c.WorkoutName, cardWidth, 80, 44)
	if err != nil {
		return nil, err
	}
	drawText(img, titleFace, cardMargin, 190, s.pal.ink, title)
	// The logo's own watt→neon gradient, as the card's one rule: data hue into
	// chrome hue, the way the bars above it climb (ADR-0005).
	gradientBar(img, image.Rect(cardMargin, 206, cardMargin+160, 212), s.pal)

	where := "Solo ride"
	if c.Place != "" {
		where = "in " + c.Place
	}
	workout := c.Workout || hasTargets(c)
	if workout && c.RoadLine != "" {
		where += " · " + c.RoadLine
	}
	pillLeft, err := s.datePill(img, c.StartedAt.Format("2 Jan 2006 · 15:04"))
	if err != nil {
		return nil, err
	}
	subFace, sub, err := s.fit(where, pillLeft-24-cardMargin, 30, 22)
	if err != nil {
		return nil, err
	}
	drawText(img, subFace, cardMargin, 258, s.pal.muted, sub)

	switch {
	case workout:
		if err := s.drawWorkoutCard(img, c); err != nil {
			return nil, err
		}
		return encode(img)
	case c.Poster():
		if err := s.drawPosterCard(img, c); err != nil {
			return nil, err
		}
		return encode(img)
	}

	fillRound(img, image.Rect(cardMargin, 286, cardRight, 660), 28, s.pal.raised)
	if err := s.drawSilhouette(img, traceBox, c); err != nil {
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
	return encode(img)
}

func encode(img *image.NRGBA) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// drawWorkoutCard is the panel and the numbers of a workout's card: the
// workout as big as the card allows, then duration, average, normalised,
// work, execution and XP in one row, then the curve.
func (s *Service) drawWorkoutCard(img *image.NRGBA, c RideCard) error {
	fillRound(img, workoutPanel, 28, s.pal.raised)
	if err := s.drawSilhouette(img, workoutBox, c); err != nil {
		return err
	}
	execution := "not scored"
	if c.ExecutionScored {
		execution = strconv.Itoa(int(c.Execution*100+0.5)) + " %"
	}
	if err := s.drawTileRow(img, 870, []tile{
		{iconClock, clock(c.Seconds), "duration"},
		{iconZap, strconv.Itoa(c.AvgWatts) + " W", "average"},
		{iconActivity, strconv.Itoa(c.NormWatts) + " W", "normalised"},
		{iconFlame, group(c.Kj) + " kJ", "work"},
		{iconTarget, execution, "execution"},
		{iconTrophy, group(c.Xp) + " XP", "earned"},
	}); err != nil {
		return err
	}
	return s.drawCurve(img, 1040, c.Curve)
}

// skyFill is the card's ground: the surface, lifted a little at the top so
// the title has something behind it and the numbers sink into the dark.
func skyFill(dst *image.NRGBA, p Palette) {
	for y := 0; y < cardSize; y++ {
		fill(dst, image.Rect(0, y, cardSize, y+1), lerp(p.skyTop(), p.surface, float64(y)/cardSize))
	}
}

func gradientBar(dst *image.NRGBA, box image.Rectangle, p Palette) {
	for x := box.Min.X; x < box.Max.X; x++ {
		at := float64(x-box.Min.X) / float64(box.Dx())
		fill(dst, image.Rect(x, box.Min.Y, x+1, box.Max.Y), lerp(p.watt, p.neon, at))
	}
}

// brandBox is where the mark and the wordmark go: centred along the top
// (#4429). Strava lays its own badges over a feed photo's corners — "Virtual"
// top left on every indoor ride, which is every WattRoom ride — so a mark in
// a corner is a mark nobody in the feed sees. The top centre is under none of
// them, and it survives a feed tile that crops the sides off a square.
var brandBox = image.Rect(cardMargin, 40, cardRight, 108)

// drawBrand centres the logo and the wordmark in brandBox.
func (s *Service) drawBrand(dst *image.NRGBA) error {
	const logo, gap = 52, 16
	face, err := s.face(32)
	if err != nil {
		return err
	}
	width := logo + gap + font.MeasureString(face, siteName).Ceil()
	x := brandBox.Min.X + (brandBox.Dx()-width)/2
	drawLogo(dst, x, 48, logo, s.pal)
	drawText(dst, face, x+logo+gap, 90, s.pal.ink, siteName)
	return nil
}

// datePill sets the date apart from the line it shares with where the ride
// was, at that line's right end, and returns the pill's left edge so the
// place can stop short of it.
func (s *Service) datePill(dst *image.NRGBA, when string) (int, error) {
	face, err := s.face(24)
	if err != nil {
		return 0, err
	}
	width := font.MeasureString(face, when).Ceil()
	box := image.Rect(cardRight-width-36, 226, cardRight, 270)
	fillRound(dst, box, 22, s.pal.raised)
	drawText(dst, face, box.Min.X+18, 256, s.pal.muted, when)
	return box.Min.X, nil
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
		fillRound(dst, box, 20, s.pal.raised)
		t.mark.draw(dst, float64(box.Min.X+24), float64(top+18), 34, s.pal.iconInk())
		valueFace, value, err := s.fit(t.value, box.Dx()-48, 46, 21)
		if err != nil {
			return err
		}
		drawText(dst, valueFace, box.Min.X+24, top+96, s.pal.ink, value)
		drawText(dst, labelFace, box.Min.X+24, top+120, s.pal.muted, t.label)
	}
	return nil
}

// drawTileRow lays any number of compact tiles in one row across the card,
// each value fitted to its own tile.
func (s *Service) drawTileRow(dst *image.NRGBA, top int, tiles []tile) error {
	labelFace, err := s.face(19)
	if err != nil {
		return err
	}
	const gap = 12
	step := (cardWidth + gap) / len(tiles)
	for i, t := range tiles {
		box := image.Rect(cardMargin+i*step, top, cardMargin+i*step+step-gap, top+120)
		fillRound(dst, box, 18, s.pal.raised)
		t.mark.draw(dst, float64(box.Min.X+18), float64(top+16), 26, s.pal.iconInk())
		valueFace, value, err := s.fit(t.value, box.Dx()-30, 36, 18)
		if err != nil {
			return err
		}
		drawText(dst, valueFace, box.Min.X+16, top+86, s.pal.ink, value)
		drawText(dst, labelFace, box.Min.X+16, top+110, s.pal.muted, t.label)
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
		drawText(dst, labelFace, x, baseline, s.pal.mutedDim, part[0]+" ")
		x += font.MeasureString(labelFace, part[0]+" ").Ceil()
		drawText(dst, valueFace, x, baseline, s.pal.ink, part[1])
		x += font.MeasureString(valueFace, part[1]).Ceil()
		if i < len(parts)-1 {
			drawText(dst, labelFace, x, baseline, s.pal.mutedDim, "   ·   ")
			x += font.MeasureString(labelFace, "   ·   ").Ceil()
		}
	}
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
			drawCenter(dst, face, (x+end)/2, box.Max.Y+32, s.pal.muted,
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
