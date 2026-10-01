package road

import (
	"bytes"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/testx"
)

func TestPackIsWhatUnpackReads(t *testing.T) {
	heights := []float64{100, 101.5, 99.25, 104, 110.01}
	b := testx.PackedRoad(2000, heights)
	r, err := UnpackRoad(b)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(r.Pack(), b) {
		t.Fatalf("Pack(UnpackRoad(b)) differs from b")
	}
}

// A cut keeps the whole samples inside the stretch, heights from the first
// of them, the turns between them, and where along the road it began.
func TestCutKeepsOnlyTheStretch(t *testing.T) {
	heights := make([]float64, 101) // 2 km, a sample every 20 m
	for i := range heights {
		heights[i] = 700 + float64(i)
	}
	r, err := UnpackRoad(testx.PackedRoad(2000, heights))
	if err != nil {
		t.Fatal(err)
	}
	for i := range r.Turns {
		r.Turns[i] = int8(i % 100)
	}
	cut, origin := r.Cut(400, 1600)
	if origin != 400 || len(cut.Heights) != 61 || len(cut.Turns) != 60 || cut.LengthM != 1200 {
		t.Fatalf("cut from %v m: %d heights, %d turns, %v m; want 400, 61, 60, 1200", origin, len(cut.Heights), len(cut.Turns), cut.LengthM)
	}
	if cut.Heights[0] != 0 || cut.Heights[60] != 60 {
		t.Errorf("heights run %v…%v, want 0…60 — relative to the stretch's start", cut.Heights[0], cut.Heights[60])
	}
	if cut.Turns[0] != 20 || cut.Turns[59] != 79 {
		t.Errorf("turns run %v…%v, want the road's own 20…79", cut.Turns[0], cut.Turns[59])
	}
}

// The attached profile is at most MaxAttachedRoadBytes (#3051): the longest
// route, a sample every 20 m, packs inside it.
func TestTheLongestRoadPacksWithinTheAttachedCeiling(t *testing.T) {
	n := protocol.MaxRouteMeters/20 + 1
	b := testx.PackedRoad(protocol.MaxRouteMeters, make([]float64, n))
	if len(b) > protocol.MaxAttachedRoadBytes {
		t.Fatalf("a %d km road packs to %d bytes, over the %d the ceiling allows", protocol.MaxRouteMeters/1000, len(b), protocol.MaxAttachedRoadBytes)
	}
}
