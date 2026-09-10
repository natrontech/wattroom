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
			if got := WeekStreak(weeks, now, time.UTC); got != tc.want {
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

// The week the streak counts is the RIDER's (#2063, docs/SPEC.md's day
// boundary). A Monday-00:30 ride in Zurich is Sunday-22:30 in UTC, so UTC
// bucketing filed it into the week before — and where the rider also rode
// that earlier week, the two weeks collapsed into one and the streak halved.
func TestWeekStreakCountsTheRidersWeekNotUTCs(t *testing.T) {
	zurich, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		t.Fatal(err)
	}
	// Monday 2026-09-07, 00:30 in Zurich — 22:30 the Sunday before, in UTC.
	monday0030 := time.Date(2026, 9, 6, 22, 30, 0, 0, time.UTC)
	// The Sunday the clocks go back.
	dstSunday := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	// `weeks` arrive already bucketed by the query, so each case carries the
	// weeks its own zone would have produced for the same rides.
	cases := []struct {
		name  string
		loc   *time.Location
		now   time.Time
		weeks []string
		want  int
	}{
		{"the rider's zone sees two weeks", zurich, monday0030,
			[]string{"2026-09-07", "2026-08-31"}, 2},
		{"UTC collapsed them into one", time.UTC, monday0030,
			[]string{"2026-08-31"}, 1},
		// The forgiving current week is why a single ride does not show the
		// bug: one Monday-00:30 ride reads as 1 in either zone.
		{"one ride reads the same in either zone", zurich, monday0030,
			[]string{"2026-09-07"}, 1},
		{"a rider with no zone is still counted, at UTC", Zone(nil), monday0030,
			[]string{"2026-08-31"}, 1},
		// Across a DST transition the week boundary must not move: two rides
		// a week apart are still two consecutive weeks.
		{"a week containing a DST transition is still one week", zurich, dstSunday,
			[]string{"2026-10-19", "2026-10-12"}, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			weeks := make([]time.Time, len(tc.weeks))
			for i, w := range tc.weeks {
				weeks[i] = week(w)
			}
			if got := WeekStreak(weeks, tc.now, tc.loc); got != tc.want {
				t.Fatalf("WeekStreak in %s = %d, want %d", tc.loc, got, tc.want)
			}
		})
	}
}
