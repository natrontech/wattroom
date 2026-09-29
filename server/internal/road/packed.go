package road

import (
	"encoding/binary"
	"errors"
	"fmt"
	"strconv"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Road is a road as $lib/road's packRoad writes it (#3023, ADR-0063): heights
// and turns every ~20 m, what anyone but a route's owner may be given.
type Road struct {
	// Metres from the first sample to the last.
	LengthM float64
	// Metres above sea at each sample — or above the first sample, on a road
	// cut for someone who is not its owner (Cut).
	Heights []float64
	// Whole degrees the road turns from each sample to the next, positive to
	// the right; one fewer than Heights.
	Turns []int8
}

const packedVersion = 1

// UnpackRoad reads packRoad's little-endian bytes and refuses anything it
// could not have written: another version, a length that does not match the
// sample count, a road outside docs/SPEC.md's 2–200 km, or samples closer
// than its 10 m resampling step.
//
//	u8   version
//	u32  samples
//	u32  length, cm
//	i32  first height, cm
//	i16  × (samples − 1)  height change, cm
//	i8   × (samples − 1)  turn, degrees
func UnpackRoad(b []byte) (Road, error) {
	if len(b) < 13 || b[0] != packedVersion {
		return Road{}, errors.New("road: not a packed road")
	}
	n := binary.LittleEndian.Uint32(b[1:5])
	if n < 2 || uint64(len(b)) != 13+3*uint64(n-1) {
		return Road{}, errors.New("road: sample count does not match the bytes")
	}
	lengthM := float64(binary.LittleEndian.Uint32(b[5:9])) / 100
	if lengthM < protocol.MinRouteMeters || lengthM > protocol.MaxRouteMeters {
		return Road{}, fmt.Errorf("road: %.0f m is outside %d–%d m", lengthM, protocol.MinRouteMeters, protocol.MaxRouteMeters)
	}
	if float64(n-1) > lengthM/10 {
		return Road{}, errors.New("road: samples closer than 10 m")
	}
	heights := make([]float64, n)
	turns := make([]int8, n-1)
	cm := int64(int32(binary.LittleEndian.Uint32(b[9:13]))) //nolint:gosec // i32 on the wire
	heights[0] = float64(cm) / 100
	for i := 1; i < int(n); i++ {
		cm += int64(int16(binary.LittleEndian.Uint16(b[13+2*(i-1):]))) //nolint:gosec // i16 on the wire
		heights[i] = float64(cm) / 100
		turns[i-1] = int8(b[13+2*(int(n)-1)+(i-1)]) //nolint:gosec // i8 on the wire
	}
	return Road{LengthM: lengthM, Heights: heights, Turns: turns}, nil
}

// GainM is the metres climbed over the road's heights.
func (r Road) GainM() float64 {
	gain := 0.0
	for i := 1; i < len(r.Heights); i++ {
		gain += max(0, r.Heights[i]-r.Heights[i-1])
	}
	return gain
}

// Name is the name every surface but the owner's shows (ADR-0063): numbers
// only, `Road · 52.9 km · 1,312 m` — $lib/road's roadName, and read off the
// stored road so a place can never travel in it.
func (r Road) Name() string {
	return fmt.Sprintf("Road · %.1f km · %s m", r.LengthM/1000, thousands(int64(r.GainM()+0.5)))
}

// thousands writes n with a comma every three digits, as en-US does.
func thousands(n int64) string {
	s := strconv.FormatInt(n, 10)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}
