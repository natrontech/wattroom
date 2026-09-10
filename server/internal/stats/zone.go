package stats

import "time"

// The rider's calendar day (#2063, ADR-0016's second 2026-09-10 amendment, and the
// day-boundary rule in docs/SPEC.md). Four surfaces used to disagree about
// when a rider's day starts — the rider page's month read `users.timezone`
// while Load, the streak week and the achievement clock bucketed at UTC — so
// a ride finished at 21:00 CET was on today in one place and tomorrow in
// three others. Everything rider-scoped now buckets here.
//
// Room-scoped buckets stay at UTC on purpose: a room's riders are in several
// zones and a room has no zone of its own.

// Zone is the zone a rider's own days are counted in: the one the browser
// reported, or UTC when it never did or reported a name we will not use.
// `users.timezone` is nullable — a rider who has never opened the app in a
// browser that told us has no zone at all.
func Zone(tz *string) *time.Location {
	if tz == nil || *tz == "" || *tz == localZone {
		return time.UTC
	}
	loc, err := time.LoadLocation(*tz)
	if err != nil {
		return time.UTC
	}
	return loc
}

// localZone is the one name LoadLocation accepts that we must refuse. It
// resolves to the SERVER's zone, which is precisely what a rider's day is not
// allowed to depend on, and it is a name Postgres does not know at all — `at
// time zone 'Local'` is an error, so letting it through cost the rider their
// streak bonus without a word and 500'd their own page. POST /api/me/timezone
// validates with LoadLocation and so accepts it from any client.
const localZone = "Local"

// ZoneName is Zone's answer as Postgres wants it, for the queries that bucket
// in SQL (`at time zone $tz`). Derived from Zone rather than validated again,
// so the SQL and the Go cannot disagree about which zone a rider is in.
func ZoneName(tz *string) string {
	return Zone(tz).String()
}

// DayStart is the bucket key for the day t falls on in loc: t's local
// calendar date, returned as UTC midnight.
//
// UTC midnight rather than local midnight is deliberate. These are bucket
// keys, not instants: they are compared with Equal, stepped with AddDate and
// formatted as dates, and the other half of every comparison is a bare date
// out of Postgres, which pgx hands back as UTC midnight. A local-midnight key
// carries the same calendar day and never compares equal to one of those, so
// mixing the two silently finds nothing rather than failing loudly.
func DayStart(t time.Time, loc *time.Location) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// DayKey is DayStart as the string the daily-load maps are keyed by.
func DayKey(t time.Time, loc *time.Location) string {
	return DayStart(t, loc).Format(time.DateOnly)
}

// WeekStart is the Monday of t's week in loc, as UTC midnight — the streak's
// bucket, matching Postgres `date_trunc('week', started_at at time zone tz)`,
// whose rows this is compared against. See DayStart on why UTC midnight.
func WeekStart(t time.Time, loc *time.Location) time.Time {
	local := t.In(loc)
	y, m, d := local.Date()
	offset := (int(local.Weekday()) + 6) % 7
	return time.Date(y, m, d-offset, 0, 0, 0, 0, time.UTC)
}
