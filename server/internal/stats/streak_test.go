package stats

import (
	"testing"
	"time"
)

func week(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestWeekStreak(t *testing.T) {
	// A Wednesday; the current week began Monday 2026-08-24.
	now := week("2026-08-26")
	cases := []struct {
		name  string
		weeks []string
		want  int
	}{
		{"empty", nil, 0},
		{"this week only", []string{"2026-08-24"}, 1},
		{"three consecutive", []string{"2026-08-24", "2026-08-17", "2026-08-10"}, 3},
		{"gap breaks it", []string{"2026-08-24", "2026-08-10"}, 1},
		{"no ride yet this week keeps last week's streak", []string{"2026-08-17", "2026-08-10"}, 2},
		{"lapsed two weeks is dead", []string{"2026-08-10", "2026-08-03"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			weeks := make([]time.Time, len(tc.weeks))
			for i, w := range tc.weeks {
				weeks[i] = week(w)
			}
			if got := WeekStreak(weeks, now); got != tc.want {
				t.Fatalf("got %d want %d", got, tc.want)
			}
		})
	}
}

func TestStreakBonusCap(t *testing.T) {
	if StreakBonus(3) != 75 || StreakBonus(20) != 250 {
		t.Fatal("SPEC: 25 x streak, capped at 250")
	}
}
