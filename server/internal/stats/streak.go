package stats

import "time"

// WeekStreak counts consecutive weeks with a ride, ending at the current or
// previous week — riding this Monday keeps last week's streak alive, and a
// streak is not broken mid-week by not having ridden yet (docs/SPEC.md's
// streak bonus counts the current streak, not a lapsed one).
func WeekStreak(weeks []time.Time, now time.Time) int {
	if len(weeks) == 0 {
		return 0
	}
	weekOf := func(t time.Time) time.Time {
		t = t.UTC()
		// Monday-start weeks, matching Postgres date_trunc('week').
		offset := (int(t.Weekday()) + 6) % 7
		return time.Date(t.Year(), t.Month(), t.Day()-offset, 0, 0, 0, 0, time.UTC)
	}
	current := weekOf(now)
	streak := 0
	expect := current
	for _, week := range weeks {
		w := weekOf(week)
		if streak == 0 && w.Equal(current.AddDate(0, 0, -7)) {
			// No ride yet this week: the streak stands from last week.
			expect = w
		}
		if !w.Equal(expect) {
			break
		}
		streak++
		expect = expect.AddDate(0, 0, -7)
	}
	return streak
}

// StreakBonus is docs/SPEC.md's XP term: 25 × current-week-streak, capped at 250.
func StreakBonus(streak int) int {
	bonus := 25 * streak
	if bonus > 250 {
		return 250
	}
	return bonus
}
