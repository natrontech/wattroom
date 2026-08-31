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
	series := FitnessSeries(daily, first, today)
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
	restSeries := FitnessSeries(rest, first, today)
	lastRest := restSeries[len(restSeries)-1]
	if lastRest.Form <= 0 {
		t.Fatalf("after a rest week form must be positive, got %v", lastRest.Form)
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
	}
	for _, tt := range tests {
		if got := FormZone(tt.pct); got != tt.want {
			t.Fatalf("FormZone(%v) = %q, want %q", tt.pct, got, tt.want)
		}
	}
}
