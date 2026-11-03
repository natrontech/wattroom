package road

import "math"

// earthR is $lib/road/line's EARTH_R, the mean radius the import projects by.
const earthR = 6371008.8

// TurnsOfShape is $lib/road/profile's turnsOf over a route's own line, as
// its sealed shape keeps it: the import's smoothed line every sample, in
// polyline6, projected the way $lib/road/line's frameOf and project do. One
// turn per `every` samples, whole degrees, positive to the right; what
// rounding and the int8 clamp leave out carries into the next, so the turns
// add up to the line's heading wherever they are summed (#4379, #4383).
// shared golden vectors (testdata/turns-golden.json) hold it to the browser.
func TurnsOfShape(points []LatLon, every int) []int8 {
	n := len(points)
	if n < 2 || every < 1 {
		return nil
	}
	var lat0, lon0 float64
	for _, p := range points {
		lat0 += p.Lat
		lon0 += p.Lon
	}
	lat0 /= float64(n)
	lon0 /= float64(n)
	kz := math.Pi / 180 * earthR
	kx := kz * math.Cos(lat0*math.Pi/180)
	x := make([]float64, n)
	z := make([]float64, n)
	for i, p := range points {
		x[i] = (p.Lon - lon0) * kx
		z[i] = -(p.Lat - lat0) * kz
	}
	// Bearing of each segment, unwrapped so no turn jumps the ±180° seam.
	bearing := make([]float64, n-1)
	for i := range n - 1 {
		b := math.Atan2(x[i+1]-x[i], z[i]-z[i+1])
		if i > 0 {
			// JavaScript's Math.round: halves go up.
			b -= 2 * math.Pi * math.Floor((b-bearing[i-1])/(2*math.Pi)+0.5)
		}
		bearing[i] = b
	}
	var turns []int8
	carry := 0.0
	for i := 0; i+every < n; i += every {
		to := min(i+every, n-2)
		deg := (bearing[to]-bearing[i])*180/math.Pi + carry
		turn := max(-127, min(127, math.Floor(deg+0.5)))
		carry = deg - turn
		turns = append(turns, int8(turn))
	}
	return turns
}
