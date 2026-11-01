package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A trainer sample that lands a second late leaves the second before it empty;
// the record holds the last reading across a short silence so the saved ride
// keeps its length (#4316). A longer silence stays a gap.
func TestAccumulatorHoldsShortSilence(t *testing.T) {
	tests := []struct {
		name    string
		seconds []int
		want    int
	}{
		{"every second", []int{0, 1, 2, 3}, 4},
		{"one late sample", []int{0, 1, 3, 4}, 5},
		{"longest held silence", []int{0, 1 + protocol.MaxHeldGap}, 2 + protocol.MaxHeldGap},
		{"a dropout stays a gap", []int{0, 2 + protocol.MaxHeldGap}, 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := newAccumulator()
			for i, second := range tc.seconds {
				a.add("r", protocol.RiderMetrics{Seq: i + 1, Watts: 100 + i}, nil, 0, second)
			}
			if got := a.count("r"); got != tc.want {
				t.Fatalf("samples = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestAccumulatorHeldSecondCarriesLastReading(t *testing.T) {
	a := newAccumulator()
	a.add("r", protocol.RiderMetrics{Seq: 1, Watts: 150}, nil, 0, 0)
	a.add("r", protocol.RiderMetrics{Seq: 2, Watts: 200}, nil, 0, 2)
	got := a.byRider["r"].inOrder()
	if len(got) != 3 || got[1].Clock != 1 || got[1].Watts != 150 || got[2].Watts != 200 {
		t.Fatalf("record = %+v, want 150 held across second 1 then 200", got)
	}
}
