package stats

import (
	"testing"
	"time"
)

func mustLoad(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("LoadLocation(%q): %v", name, err)
	}
	return loc
}

func ptr(s string) *string { return &s }

func TestZoneFallsBackToUTC(t *testing.T) {
	cases := []struct {
		name string
		tz   *string
		want string
	}{
		{"never reported", nil, "UTC"},
		{"reported empty", ptr(""), "UTC"},
		{"a name Go cannot load", ptr("Nowhere/Atlantis"), "UTC"},
		{"a path, not a name", ptr("../../etc/passwd"), "UTC"},
		{"a real zone", ptr("Europe/Zurich"), "Europe/Zurich"},
		{"a real zone west of UTC", ptr("America/Denver"), "America/Denver"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Zone(tc.tz).String(); got != tc.want {
				t.Fatalf("Zone = %q, want %q", got, tc.want)
			}
			// The SQL and the Go must never disagree about the rider's zone:
			// one bucketing in Europe/Zurich while the other bucketed in UTC
			// is the whole of #2063 in one rider.
			if got := ZoneName(tc.tz); got != tc.want {
				t.Fatalf("ZoneName = %q, want %q", got, tc.want)
			}
		})
	}
}

// DayKey is the daily-Load bucket. The cases that matter are the ones where
// the rider's calendar date and UTC's differ.
func TestDayKey(t *testing.T) {
	zurich := mustLoad(t, "Europe/Zurich")
	denver := mustLoad(t, "America/Denver")
	cases := []struct {
		name string
		when string // RFC3339, the instant the ride started
		loc  *time.Location
		want string
	}{
		{"midday is the same day everywhere", "2026-09-07T12:00:00Z", zurich, "2026-09-07"},
		// The report in #2063: 00:30 in Zurich is still yesterday in UTC.
		{"just after local midnight is today, not yesterday", "2026-09-06T22:30:00Z", zurich, "2026-09-07"},
		{"UTC keeps the UTC day for the same instant", "2026-09-06T22:30:00Z", time.UTC, "2026-09-06"},
		// The mirror image, west of UTC: 21:00 in Denver is already tomorrow
		// in UTC, so UTC bucketing pushed an evening ride a day forward.
		{"an evening ride west of UTC is not tomorrow", "2026-09-08T03:00:00Z", denver, "2026-09-07"},
		{"UTC calls that same instant tomorrow", "2026-09-08T03:00:00Z", time.UTC, "2026-09-08"},
		// DST: 00:30 local on the day the clocks go back. The offset is +02:00
		// until 03:00 local, so this is 22:30 UTC the day before.
		{"local midnight on the day DST ends", "2026-10-24T22:30:00Z", zurich, "2026-10-25"},
		// And the day they go forward: +01:00 until 02:00 local.
		{"local midnight on the day DST starts", "2026-03-28T23:30:00Z", zurich, "2026-03-29"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			when, err := time.Parse(time.RFC3339, tc.when)
			if err != nil {
				t.Fatal(err)
			}
			if got := DayKey(when, tc.loc); got != tc.want {
				t.Fatalf("DayKey(%s, %s) = %s, want %s", tc.when, tc.loc, got, tc.want)
			}
		})
	}
}

// WeekStart is the streak's bucket and must agree with Postgres
// date_trunc('week', started_at at time zone tz): Monday-start.
func TestWeekStart(t *testing.T) {
	zurich := mustLoad(t, "Europe/Zurich")
	cases := []struct {
		name string
		when string
		loc  *time.Location
		want string
	}{
		{"a Monday is its own week", "2026-09-07T12:00:00Z", zurich, "2026-09-07"},
		{"a Sunday belongs to the Monday before", "2026-09-13T12:00:00Z", zurich, "2026-09-07"},
		// The streak-breaking case: Monday 00:30 in Zurich is Sunday 22:30 in
		// UTC, which is the WEEK BEFORE. One ride, two different weeks.
		{"Monday 00:30 local is this week", "2026-09-06T22:30:00Z", zurich, "2026-09-07"},
		{"the same instant is last week in UTC", "2026-09-06T22:30:00Z", time.UTC, "2026-08-31"},
		// Across a DST transition the week must not shift: the Sunday the
		// clocks change still belongs to the Monday before it.
		{"the Sunday DST starts", "2026-03-29T01:30:00Z", zurich, "2026-03-23"},
		{"the Sunday DST ends", "2026-10-25T01:30:00Z", zurich, "2026-10-19"},
		{"a month boundary inside a week", "2026-10-01T12:00:00Z", zurich, "2026-09-28"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			when, err := time.Parse(time.RFC3339, tc.when)
			if err != nil {
				t.Fatal(err)
			}
			got := WeekStart(when, tc.loc)
			if got.Format(time.DateOnly) != tc.want {
				t.Fatalf("WeekStart(%s, %s) = %s, want %s", tc.when, tc.loc, got.Format(time.DateOnly), tc.want)
			}
			if got.Weekday() != time.Monday {
				t.Fatalf("WeekStart returned a %s, want a Monday", got.Weekday())
			}
			// Bucket keys are stepped with AddDate and formatted as dates;
			// a local-midnight instant would drift on a DST day.
			if got.Location() != time.UTC {
				t.Fatalf("WeekStart returned a %s instant, want UTC", got.Location())
			}
		})
	}
}
