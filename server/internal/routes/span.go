package routes

import (
	"math"
	"strings"

	"github.com/natrontech/wattroom/server/internal/road"
)

// The crew's map (#3096, ADR-0063): the owner's shape between the anchors,
// the same stretch the crew's road is cut to. The road is in its own metres
// and the shape in its own, so the cut is taken at the same fractions of each
// — and never less than the hidden ends' own metres of the shape, so a shape
// shorter than its road still hides as much of its ends as the road does.

// span is the part of a shape from `fromM` to `toM` of a road `lengthM` long,
// its two ends interpolated onto the line; nil when the ends leave nothing.
func span(points []road.LatLon, fromM, toM, lengthM float64) []road.LatLon {
	along := make([]float64, len(points))
	for i := 1; i < len(points); i++ {
		along[i] = along[i-1] + metresBetween(points[i-1], points[i])
	}
	total := along[len(along)-1]
	from := max(fromM/lengthM*total, fromM)
	to := min(toM/lengthM*total, total-(lengthM-toM))
	if to <= from {
		return nil
	}
	out := []road.LatLon{at(points, along, from)}
	for i, a := range along {
		if a > from && a < to {
			out = append(out, points[i])
		}
	}
	return append(out, at(points, along, to))
}

// at is the point `m` metres along the line.
func at(points []road.LatLon, along []float64, m float64) road.LatLon {
	for i := 1; i < len(points); i++ {
		if along[i] >= m {
			f := 0.0
			if seg := along[i] - along[i-1]; seg > 0 {
				f = (m - along[i-1]) / seg
			}
			a, b := points[i-1], points[i]
			return road.LatLon{Lat: a.Lat + (b.Lat-a.Lat)*f, Lon: a.Lon + (b.Lon-a.Lon)*f}
		}
	}
	return points[len(points)-1]
}

// metresBetween is the great-circle distance between two points.
func metresBetween(a, b road.LatLon) float64 {
	const earthM = 6_371_000
	rad := math.Pi / 180
	dLat, dLon := (b.Lat-a.Lat)*rad, (b.Lon-a.Lon)*rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(a.Lat*rad)*math.Cos(b.Lat*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthM * math.Asin(math.Sqrt(h))
}

// encodePolyline6 is $lib/road's encodePolyline6: Google's encoded polyline
// at 1e-6 degrees, the form a shape is stored and sent in.
func encodePolyline6(points []road.LatLon) string {
	var b strings.Builder
	put := func(delta int64) {
		v := delta << 1
		if delta < 0 {
			v = ^v
		}
		for v >= 0x20 {
			b.WriteByte(byte((0x20 | (v & 0x1f)) + 63)) //nolint:gosec // 6 bits
			v >>= 5
		}
		b.WriteByte(byte(v + 63)) //nolint:gosec // under 0x20
	}
	var lat, lon int64
	for _, p := range points {
		la, lo := int64(math.Round(p.Lat*1e6)), int64(math.Round(p.Lon*1e6))
		put(la - lat)
		put(lo - lon)
		lat, lon = la, lo
	}
	return b.String()
}
