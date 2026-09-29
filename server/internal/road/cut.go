package road

import (
	"encoding/binary"
	"math"
)

// Cut is the stretch of the road from fromM to toM (#3051, ADR-0063): the
// whole samples inside it, their heights relative to the first, and the
// turns between them — with how far along the road that first sample is.
// What a crew is sent of a route that is not theirs: nothing of the ends it
// hides, and no altitude that places it.
func (r Road) Cut(fromM, toM float64) (Road, float64) {
	step := r.Step()
	first := int(math.Ceil(fromM / step))
	last := min(int(math.Floor(toM/step)), len(r.Heights)-1)
	if first < 0 {
		first = 0
	}
	if last-first < 1 {
		return Road{}, 0
	}
	heights := make([]float64, last-first+1)
	for i := range heights {
		heights[i] = r.Heights[first+i] - r.Heights[first]
	}
	return Road{
		LengthM: float64(last-first) * step,
		Heights: heights,
		Turns:   append([]int8(nil), r.Turns[first:last]...),
	}, float64(first) * step
}

// Pack writes the road as $lib/road's packRoad does (#3023), the bytes
// UnpackRoad reads back.
//
//	u8   version
//	u32  samples
//	u32  length, cm
//	i32  first height, cm
//	i16  × (samples − 1)  height change, cm
//	i8   × (samples − 1)  turn, degrees
func (r Road) Pack() []byte {
	n := len(r.Heights)
	b := make([]byte, 13+3*(n-1))
	cm := func(m float64) int64 { return int64(math.Round(m * 100)) }
	b[0] = packedVersion
	binary.LittleEndian.PutUint32(b[1:], uint32(n))                       //nolint:gosec // at most 20,001 samples
	binary.LittleEndian.PutUint32(b[5:], uint32(cm(r.LengthM)))           //nolint:gosec // at most 200 km
	binary.LittleEndian.PutUint32(b[9:], uint32(int32(cm(r.Heights[0])))) //nolint:gosec // i32 on the wire
	for i := 1; i < n; i++ {
		binary.LittleEndian.PutUint16(b[13+2*(i-1):], uint16(int16(cm(r.Heights[i])-cm(r.Heights[i-1])))) //nolint:gosec // the stored grade keeps a step inside an i16
		if i-1 < len(r.Turns) {
			b[13+2*(n-1)+(i-1)] = byte(r.Turns[i-1]) //nolint:gosec // an i8 on the wire, two's complement by design
		}
	}
	return b
}
