package stats

import (
	"math"
	"testing"
	"time"
)

func steady(watts, seconds int) []int {
	out := make([]int, seconds)
	for i := range out {
		out[i] = watts
	}
	return out
}

func TestNormPower(t *testing.T) {
	tests := []struct {
		name  string
		watts []int
		want  int
	}{
		{"empty", nil, 0},
		{"short ride falls back to average", steady(200, 600), 200},
		{"steady hour equals average", steady(250, 3600), 250},
		// The two numbers SPEC pins (#1692): one sample under 20 min is the
		// plain average, and the 30 s window over a 300→100 W step lands on
		// 252 — a 10 s or 300 s window does not.
		{"1199 s is the average, not normalised", append(steady(300, 600), steady(100, 599)...), 200},
		{"30 s window over a step", append(steady(300, 600), steady(100, 600)...), 252},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormPower(tt.watts); got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}

	// Surging rides weigh above average: 4th-power mean rewards the spikes.
	surgy := append(steady(300, 1200), steady(100, 1200)...)
	avg := 200
	if got := NormPower(surgy); got <= avg {
		t.Fatalf("surgy NormPower %d must exceed average %d", got, avg)
	}
}

func TestLoad(t *testing.T) {
	// One hour exactly at FTP = 100 by construction (SPEC).
	if got := Load(250, 250, 3600); math.Abs(got-100) > 1e-9 {
		t.Fatalf("hour at FTP: got %v, want 100", got)
	}
	// Half hour at FTP = 50.
	if got := Load(250, 250, 1800); math.Abs(got-50) > 1e-9 {
		t.Fatalf("half hour at FTP: got %v, want 50", got)
	}
	if got := Load(200, 0, 3600); got != 0 {
		t.Fatalf("zero FTP must be zero load, got %v", got)
	}
}

func TestFitnessSeries(t *testing.T) {
	// Constant 100 Load/day converges toward Fitness 100, Fatigue faster.
	today := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	first := today.AddDate(0, 0, -299)
	daily := map[string]float64{}
	for d := first; !d.After(today); d = d.AddDate(0, 0, 1) {
		daily[d.UTC().Format(time.DateOnly)] = 100
	}
	series := FitnessSeries(daily, first, today, time.UTC)
	if len(series) != 300 {
		t.Fatalf("expected 300 days, got %d", len(series))
	}
	last := series[len(series)-1]
	if last.Fitness < 99 || last.Fitness > 100 {
		t.Fatalf("fitness must converge to 100, got %v", last.Fitness)
	}
	if last.Fatigue < last.Fitness {
		t.Fatalf("under constant load fatigue (%v) converges at least as fast as fitness (%v)",
			last.Fatigue, last.Fitness)
	}
	// Day one: form uses yesterday's (zero) values.
	if series[0].Form != 0 {
		t.Fatalf("first day form must be 0, got %v", series[0].Form)
	}
	// A rest week after constant load goes fresh: fatigue decays faster.
	rest := map[string]float64{}
	for k, v := range daily {
		rest[k] = v
	}
	for d := today.AddDate(0, 0, -6); !d.After(today); d = d.AddDate(0, 0, 1) {
		rest[d.UTC().Format(time.DateOnly)] = 0
	}
	restSeries := FitnessSeries(rest, first, today, time.UTC)
	lastRest := restSeries[len(restSeries)-1]
	if lastRest.Form <= 0 {
		t.Fatalf("after a rest week form must be positive, got %v", lastRest.Form)
	}
}

func TestSuggestToday(t *testing.T) {
	tests := []struct {
		name                                 string
		formPct, fitNow, fit7d, yday, median float64
		daysSince                            int
		want                                 string // intent, "" = nil
	}{
		{"deep fatigue wins first", -35, 30, 20, 100, 40, 0, "recover"},
		{"long break", 0, 10, 10, 0, 40, 14, "restart"},
		{"big day yesterday", 0, 30, 28, 70, 40, 1, "endurance"},
		{"steep ramp", 0, 30, 20, 0, 40, 1, "endurance"},
		{"fresh", 10, 30, 28, 0, 40, 1, "intensity"},
		{"grey day, nothing to say", 0, 30, 28, 0, 40, 1, ""},
		{"no rides yet means no median rule", 0, 30, 28, 70, 0, 1, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SuggestToday(tt.formPct, tt.fitNow, tt.fit7d, tt.yday, tt.median, tt.daysSince)
			intent := ""
			if got != nil {
				intent = got.Intent
				if got.Why == "" {
					t.Fatal("a suggestion always carries its why")
				}
			}
			if intent != tt.want {
				t.Fatalf("got %q, want %q", intent, tt.want)
			}
		})
	}
}

func TestFormZone(t *testing.T) {
	tests := []struct {
		pct  float64
		want string
	}{
		{25, "transition"},
		{10, "fresh"},
		{0, "grey"},
		{-20, "optimal"},
		{-35, "high_risk"},
		// The boundaries (#1692): a band is closed at its low edge, so the
		// number SPEC names belongs to the band above it — except the top,
		// where transition begins strictly past +20.
		{20.01, "transition"},
		{20, "fresh"},
		{5, "fresh"},
		{4.99, "grey"},
		{-10, "grey"},
		{-10.01, "optimal"},
		{-30, "optimal"},
		{-30.01, "high_risk"},
	}
	for _, tt := range tests {
		if got := FormZone(tt.pct); got != tt.want {
			t.Fatalf("FormZone(%v) = %q, want %q", tt.pct, got, tt.want)
		}
	}
}

// The day loop steps calendar days, and a DST transition must neither skip
// one nor emit it twice — a series with a missing day would run the EWMAs one
// day short and a doubled one would count that day's load twice (#2063).
func TestFitnessSeriesStepsCalendarDaysAcrossDST(t *testing.T) {
	zurich, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name         string
		first, today string // instants, RFC3339
		want         []string
	}{
		{
			// Clocks go forward on Sunday 2026-03-29: local midnights are
			// 23 h apart across it.
			name:  "spring forward",
			first: "2026-03-27T09:00:00Z",
			today: "2026-03-31T09:00:00Z",
			want:  []string{"2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"},
		},
		{
			// And back on Sunday 2026-10-25: 25 h apart.
			name:  "fall back",
			first: "2026-10-23T09:00:00Z",
			today: "2026-10-27T09:00:00Z",
			want:  []string{"2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"},
		},
		{
			// The rider's own days, not UTC's: the first ride was 00:30 on
			// the 7th in Zurich, so the series starts there and not on the 6th.
			name:  "a ride just after local midnight starts the series on its own day",
			first: "2026-09-06T22:30:00Z",
			today: "2026-09-08T09:00:00Z",
			want:  []string{"2026-09-07", "2026-09-08"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			first, err := time.Parse(time.RFC3339, tc.first)
			if err != nil {
				t.Fatal(err)
			}
			today, err := time.Parse(time.RFC3339, tc.today)
			if err != nil {
				t.Fatal(err)
			}
			series := FitnessSeries(map[string]float64{}, first, today, zurich)
			got := make([]string, len(series))
			for i, p := range series {
				got[i] = p.Date
			}
			if len(got) != len(tc.want) {
				t.Fatalf("series days = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("series days = %v, want %v", got, tc.want)
				}
			}
		})
	}
}
