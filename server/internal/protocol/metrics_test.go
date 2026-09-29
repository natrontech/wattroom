package protocol

import "testing"

func TestRoadInBounds(t *testing.T) {
	cases := []struct {
		name string
		m    RiderMetrics
		ok   bool
	}{
		{"no road", RiderMetrics{}, true},
		{"the start, at sea level", RiderMetrics{M: 0, Alt: 0}, true},
		{"the end of the longest route", RiderMetrics{M: MaxRouteMeters, Alt: 2757}, true},
		{"the .fit's lowest height", RiderMetrics{M: 10, Alt: MinRoadAltM}, true},
		{"the highest height", RiderMetrics{M: 10, Alt: MaxRoadAltM}, true},
		{"behind the start", RiderMetrics{M: -0.01}, false},
		{"past the longest route", RiderMetrics{M: MaxRouteMeters + 0.01}, false},
		{"under the .fit's floor", RiderMetrics{Alt: MinRoadAltM - 0.01}, false},
		{"above any road", RiderMetrics{Alt: MaxRoadAltM + 0.01}, false},
	}
	for _, c := range cases {
		if got := c.m.RoadInBounds(); got != c.ok {
			t.Errorf("%s: RoadInBounds = %v, want %v", c.name, got, c.ok)
		}
	}
}

func TestRoadFollows(t *testing.T) {
	cases := []struct {
		name       string
		prev, next float64
		seconds    int
		ok         bool
	}{
		{"standing still", 100, 100, 1, true},
		{"riding on", 100, 112.5, 1, true},
		{"the fastest a second allows", 100, 100 + MaxRoadSpeedMps, 1, true},
		{"faster than that", 100, 100.01 + MaxRoadSpeedMps, 1, false},
		{"a gap allows its seconds' worth", 100, 100 + 3*MaxRoadSpeedMps, 3, true},
		{"back down the road", 100, 99.99, 1, false},
	}
	for _, c := range cases {
		got := RoadFollows(RiderMetrics{M: c.prev}, RiderMetrics{M: c.next}, c.seconds)
		if got != c.ok {
			t.Errorf("%s: RoadFollows(%v → %v in %ds) = %v, want %v", c.name, c.prev, c.next, c.seconds, got, c.ok)
		}
	}
}
