package og

import (
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

// The silent failure: a workout on a road that still draws its road. The
// workout's blocks fill the panel — the sweet spot blocks sit at 90 % of FTP
// in Z3's colour, level across their minutes — and the road adds nothing to
// the graph: the same workout off a road draws the same pixels there.
func TestAWorkoutOnARoadDrawsOnlyTheWorkout(t *testing.T) {
	easy := func(c RideCard) RideCard {
		// Ridden easy throughout, so the watts line runs under the blocks'
		// top edges rather than over them.
		for i := range c.Watts {
			c.Watts[i] = 120
		}
		return c
	}
	ride := easy(workoutOnRoad())
	ride.RoadLine = "Virtual route · 12.0 km · 360 m"
	img := decode(t, mustRender(t, ride))
	if !hasZoneInk(img, workoutBox) {
		t.Fatal("no block colour in the panel: the workout was not drawn")
	}
	// The first sweet-spot block runs from 10 to 18 minutes of the ride's
	// 51: its top edge is level, where a road's profile would not be.
	n := float64(len(ride.Watts))
	at := func(second float64) int {
		x := workoutBox.Min.X + int(second/n*float64(workoutBox.Dx()))
		for y := workoutBox.Min.Y; y < workoutBox.Max.Y; y++ {
			if near(img.At(x, y), zoneInk[3]) {
				return y
			}
		}
		return workoutBox.Max.Y
	}
	if a, b := at(700), at(1000); a == workoutBox.Max.Y || a-b > 3 || b-a > 3 {
		t.Errorf("the 90 %% block's top sits at %d and %d px; want one level edge", a, b)
	}
	// Far taller than the old panel's whole graph: the workout fills the card.
	if tall := workoutBox.Max.Y - at(700); tall < 300 {
		t.Errorf("the 90 %% block stands %d px tall; want the workout to fill the panel", tall)
	}
	offImg := decode(t, mustRender(t, easy(workoutCard())))
	for y := workoutBox.Min.Y; y < workoutBox.Max.Y; y += 2 {
		for x := workoutBox.Min.X; x < workoutBox.Max.X; x += 2 {
			if !alike(img.At(x, y), offImg.At(x, y)) {
				t.Fatalf("the road drew into the workout's graph at %d,%d", x, y)
			}
		}
	}
}

// A workout that asks for no watts (only sprints, or saved before rides kept
// their blocks) still gets the workout's card: its watts by zone fill the
// panel, and its execution tile says it was not scored rather than 0 %.
func TestAWorkoutWithNoTargetsDrawsItsWatts(t *testing.T) {
	c := workoutCard()
	c.Targets, c.HR, c.AvgHR = nil, nil, 0
	c.ExecutionScored, c.Execution = false, 0
	img := decode(t, mustRender(t, c))
	if !hasZoneInk(img, workoutBox) {
		t.Error("no watts drawn in the workout's panel")
	}
}

// The heart rate is drawn in the live colour over a workout's watts, and a
// ride without one draws none.
func TestAWorkoutCardDrawsItsHeartRate(t *testing.T) {
	watt := Palette{}.orDefault().watt
	drawn := func(c RideCard) bool {
		img := decode(t, mustRender(t, c))
		for y := workoutBox.Min.Y; y < workoutBox.Max.Y; y++ {
			for x := workoutBox.Min.X; x < workoutBox.Max.X; x += 2 {
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
