package testx

import (
	"encoding/binary"
	"math"
)

// PackedRoad writes a road the way $lib/road's packRoad does — the bytes a
// browser posts to /api/routes — from a length in metres and a height per
// sample, with no turns. The server only ever reads these, so the writer
// lives with the tests.
func PackedRoad(lengthM float64, heights []float64) []byte {
	n := len(heights)
	b := make([]byte, 13+3*(n-1))
	cm := func(m float64) int64 { return int64(math.Round(m * 100)) }
	b[0] = 1
	binary.LittleEndian.PutUint32(b[1:], uint32(n))           //nolint:gosec // test fixture
	binary.LittleEndian.PutUint32(b[5:], uint32(cm(lengthM))) //nolint:gosec // test fixture
	binary.LittleEndian.PutUint32(b[9:], uint32(int32(cm(heights[0]))))
	for i := 1; i < n; i++ {
		binary.LittleEndian.PutUint16(b[13+2*(i-1):], uint16(int16(cm(heights[i])-cm(heights[i-1])))) //nolint:gosec // test fixture
	}
	return b
}

// FlatRoad is a road of lengthM with a sample every 20 m, rising `gain`
// metres evenly from 100 m above sea.
func FlatRoad(lengthM, gain float64) []byte {
	n := int(lengthM/20) + 1
	heights := make([]float64, n)
	for i := range heights {
		heights[i] = 100 + gain*float64(i)/float64(n-1)
	}
	return PackedRoad(lengthM, heights)
}

// Polyline6 is $lib/road's encodePolyline6: Google's encoded polyline at
// 1e-6 degrees.
func Polyline6(points [][2]float64) string {
	var out []byte
	put := func(delta int64) {
		v := delta << 1
		if delta < 0 {
			v = ^v
		}
		for v >= 0x20 {
			out = append(out, byte((0x20|(v&0x1f))+63))
			v >>= 5
		}
		out = append(out, byte(v+63))
	}
	var lat, lon int64
	for _, p := range points {
		a, b := int64(math.Round(p[0]*1e6)), int64(math.Round(p[1]*1e6))
		put(a - lat)
		put(b - lon)
		lat, lon = a, b
	}
	return string(out)
}
