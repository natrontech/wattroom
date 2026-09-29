package testx

import (
	"encoding/binary"
	"math"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// PackedRoad writes a road the way $lib/road's packRoad does — the bytes a
// browser posts to /api/routes — from a length in metres and a height per
// sample, with no turns. The server only ever reads these, so the writer
// lives with the tests.
func PackedRoad(lengthM float64, heights []float64) []byte {
	return PackedRoadTurning(lengthM, heights, nil)
}

// PackedRoadTurning is PackedRoad with a turn, in whole degrees, between each
// pair of samples; nil turns none.
func PackedRoadTurning(lengthM float64, heights []float64, turns []int8) []byte {
	n := len(heights)
	b := make([]byte, 13+3*(n-1))
	cm := func(m float64) int64 { return int64(math.Round(m * 100)) }
	b[0] = 1
	binary.LittleEndian.PutUint32(b[1:], uint32(n))                     //nolint:gosec // test fixture
	binary.LittleEndian.PutUint32(b[5:], uint32(cm(lengthM)))           //nolint:gosec // test fixture
	binary.LittleEndian.PutUint32(b[9:], uint32(int32(cm(heights[0])))) //nolint:gosec // i32 on the wire, test fixture
	for i := 1; i < n; i++ {
		binary.LittleEndian.PutUint16(b[13+2*(i-1):], uint16(int16(cm(heights[i])-cm(heights[i-1])))) //nolint:gosec // test fixture
		if i-1 < len(turns) {
			b[13+2*(n-1)+(i-1)] = byte(turns[i-1])
		}
	}
	return b
}

// The telling road's give-aways (#3051): what its hidden ends carry and the
// stretch between them never does.
const (
	TellingEndRiseM = 50
	TellingEndTurn  = 99
)

// TellingRoad is a 3 km road, a sample every 20 m, whose first and last
// protocol.RouteHiddenEndM give themselves away — TellingEndRiseM higher than
// the rest, turning TellingEndTurn degrees a step — while the stretch
// between rides level at 800 m, turning 1° a step. Anything of an end that
// reaches a crew shows.
func TellingRoad() []byte {
	const length, step = 3000.0, 20.0
	n := int(length/step) + 1
	heights := make([]float64, n)
	turns := make([]int8, n-1)
	hidden := func(m float64) bool {
		return m < protocol.RouteHiddenEndM || m > length-protocol.RouteHiddenEndM
	}
	for i := range heights {
		heights[i] = 800
		if hidden(float64(i) * step) {
			heights[i] += TellingEndRiseM
		}
	}
	for i := range turns {
		turns[i] = 1
		if hidden(float64(i)*step) || hidden(float64(i+1)*step) {
			turns[i] = TellingEndTurn
		}
	}
	return PackedRoadTurning(length, heights, turns)
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
			out = append(out, byte((0x20|(v&0x1f))+63)) //nolint:gosec // five bits plus 95, always a byte
			v >>= 5
		}
		out = append(out, byte(v+63)) //nolint:gosec // under 0x20 plus 63, always a byte
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
