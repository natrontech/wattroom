package road

import (
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/testx"
)

// The server reads what $lib/road's packRoad wrote (#3024), and refuses what
// it could not have: a browser is the only parser, and a hostile one is a
// browser too.
func TestUnpackRoadReadsWhatPackRoadWrites(t *testing.T) {
	good := testx.PackedRoad(2000, []float64{100, 101.5, 99.25, 104})
	rd, err := UnpackRoad(good)
	if err != nil {
		t.Fatal(err)
	}
	if rd.LengthM != 2000 || len(rd.Heights) != 4 || rd.Heights[2] != 99.25 || rd.Heights[3] != 104 {
		t.Fatalf("unpacked %+v", rd)
	}
	// 1.5 up, 2.25 down, 4.75 up.
	if gain := rd.GainM(); gain != 6.25 {
		t.Fatalf("gain %v, want 6.25", gain)
	}

	short := append([]byte{}, good...)
	short[0] = 2
	tests := map[string][]byte{
		"empty":                   nil,
		"another version":         short,
		"a sample count off":      good[:len(good)-1],
		"under 2 km":              testx.PackedRoad(1999, []float64{1, 2}),
		"over 200 km":             testx.PackedRoad(200_001, []float64{1, 2}),
		"samples closer than 10m": testx.PackedRoad(2000, make([]float64, 202)),
	}
	for name, bytes := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := UnpackRoad(bytes); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}

// A generated name is numbers only (ADR-0063), spelled as $lib/road's
// roadName spells it.
func TestARoadIsNamedByItsNumbers(t *testing.T) {
	rd := Road{LengthM: 52_900, Heights: []float64{0, 1312}}
	if got := rd.Name(); got != "Road · 52.9 km · 1,312 m" {
		t.Fatalf("named %q", got)
	}
	rd = Road{LengthM: 2_000, Heights: []float64{0, 12}}
	if got := rd.Name(); got != "Road · 2.0 km · 12 m" {
		t.Fatalf("named %q", got)
	}
}

func TestDecodePolyline6(t *testing.T) {
	// Open ocean, invented (#3505): the mid-Atlantic, a step apart, then the
	// Tasman Sea — a negative latitude and a longitude past ±100.
	points := [][2]float64{{12.345678, -35.791357}, {12.345791, -35.793049}, {-40.5, 160.25}}
	got, err := DecodePolyline6(testx.Polyline6(points), 10)
	if err != nil || len(got) != 3 || got[0].Lat != 12.345678 || got[1].Lon != -35.793049 || got[2].Lat != -40.5 || got[2].Lon != 160.25 {
		t.Fatalf("decoded %+v, %v", got, err)
	}
	for name, s := range map[string]string{
		"a character outside the alphabet": "abc def",
		"cut off mid-value":                "_",
		"a point off the globe":            testx.Polyline6([][2]float64{{91, 0}}),
		"past the limit":                   strings.Repeat(testx.Polyline6([][2]float64{{0, 0}}), 11),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodePolyline6(s, 10); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}
