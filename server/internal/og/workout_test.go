package og

import (
	"image"
	"math"
	"testing"
)

// workoutCard is a sweet-spot workout (#4430): a ramp up from half FTP, three
// eight-minute blocks at 90 % with four easy minutes between, and a ramp
// down — the watts riding a little either side of each target and the heart
// rate climbing through every block.
func workoutCard() RideCard {
	c := sampleCard()
	const ftp = 250
	type block struct {
		seconds  int
		from, to float64
	}
	plan := []block{{600, 0.5, 0.75}}
	for range 3 {
		plan = append(plan, block{480, 0.9, 0.9}, block{240, 0.55, 0.55})
	}
	plan = append(plan, block{300, 0.6, 0.4})
	c.Targets, c.Watts, c.HR = nil, nil, nil
	hr := 105.0
	for _, b := range plan {
		for i := range b.seconds {
			target := ftp * (b.from + (b.to-b.from)*float64(i)/float64(b.seconds))
			c.Targets = append(c.Targets, target)
			c.Watts = append(c.Watts, int(target+12*math.Sin(float64(len(c.Watts))/7)))
			// The heart follows the work a minute behind.
			hr += (60 + 0.42*target - hr) / 60
			c.HR = append(c.HR, int(hr))
		}
	}
	c.Seconds = len(c.Watts)
	c.AvgHR = 142
	c.Workout = true
	return c
}

// workoutOnRoad is the same workout ridden on roadCard's road: three flat
// kilometres, a six-kilometre climb and the way down, over its seconds.
func workoutOnRoad() RideCard {
	c := workoutCard()
	n := len(c.Watts)
	c.Metres = make([]float64, n)
	c.Heights = make([]float64, n)
	for i := range n {
		m := 1 + 12000*float64(i)/float64(n-1)
		c.Metres[i] = m
		switch {
		case m < 3000:
			c.Heights[i] = 500
		case m < 9000:
			c.Heights[i] = 500 + 0.06*(m-3000)
		default:
			c.Heights[i] = 860 - 0.12*(m-9000)
		}
	}
	c.WorkoutName = "Road · 12.0 km · 360 m"
	c.HeightCredit = "Heights from the route's own file"
	return c
}

// Which picture a ride gets (#4430): a free ride on a road is its road's
// poster; a workout is its workout, on a road or off one.
func TestWhichPictureARideGets(t *testing.T) {
	for _, tc := range []struct {
		name   string
		card   RideCard
		poster bool
	}{
		{"a free ride on a road", roadCard(), true},
		{"a workout on a road", workoutOnRoad(), false},
		{"a workout on no road", workoutCard(), false},
		{"a ride on no road", sampleCard(), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.card.Poster(); got != tc.poster {
				t.Errorf("poster = %v, want %v", got, tc.poster)
			}
		})
	}
}

// The silent failure: a workout on a road that still draws its road across
// the panel. The workout's blocks fill the box above the strip — the sweet
// spot blocks sit at 90 % of FTP in Z3's colour, level across their minutes
// — and the road climbs inside the strip under them, never above it.
func TestAWorkoutOnARoadDrawsTheWorkoutFirst(t *testing.T) {
	ride := workoutOnRoad()
	// Ridden easy throughout, so the watts line runs under the blocks' top
	// edges rather than over them.
	for i := range ride.Watts {
		ride.Watts[i] = 120
	}
	img := decode(t, mustRender(t, ride))
	graph := image.Rect(traceBox.Min.X, traceBox.Min.Y, traceBox.Max.X, roadStripBox.Min.Y-12)
	if !hasZoneInk(img, graph) {
		t.Fatal("no block colour above the road strip: the workout was not drawn")
	}
	// The first sweet-spot block runs from 10 to 18 minutes of the ride's
	// 51: its top edge is level, where a road's profile would not be.
	n := float64(len(ride.Watts))
	at := func(second float64) int {
		x := graph.Min.X + int(second/n*float64(graph.Dx()))
		for y := graph.Min.Y; y < graph.Max.Y; y++ {
			if near(img.At(x, y), zoneInk[3]) {
				return y
			}
		}
		return graph.Max.Y
	}
	if a, b := at(700), at(1000); a == graph.Max.Y || a-b > 3 || b-a > 3 {
		t.Errorf("the 90 %% block's top sits at %d and %d px; want one level edge", a, b)
	}
	// The road's summit, three quarters along, is higher in the strip than
	// its start — drawn small, but drawn.
	stripTop := func(frac float64) int {
		x := roadStripBox.Min.X + int(frac*float64(roadStripBox.Dx()))
		for y := roadStripBox.Min.Y; y < roadStripBox.Max.Y; y++ {
			if !alike(img.At(x, y), img.At(roadStripBox.Min.X-20, y)) {
				return y
			}
		}
		return roadStripBox.Max.Y
	}
	if start, summit := stripTop(0.1), stripTop(0.74); summit >= start-10 {
		t.Errorf("the road strip's top is %d px at the start and %d at the summit; want the summit higher", start, summit)
	}
}

// The heart rate is drawn in the live colour over a workout's watts, and a
// ride without one draws none.
func TestAWorkoutCardDrawsItsHeartRate(t *testing.T) {
	watt := Palette{}.orDefault().watt
	drawn := func(c RideCard) bool {
		img := decode(t, mustRender(t, c))
		for y := traceBox.Min.Y; y < traceBox.Max.Y; y++ {
			for x := traceBox.Min.X; x < traceBox.Max.X; x += 2 {
				if near(img.At(x, y), watt) {
					return true
				}
			}
		}
		return false
	}
	if !drawn(workoutCard()) {
		t.Error("no heart rate line over the workout")
	}
	without := workoutCard()
	without.HR, without.AvgHR = nil, 0
	if drawn(without) {
		t.Error("a heart rate line on a ride that read none")
	}
}
