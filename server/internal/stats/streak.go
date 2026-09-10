package stats

import "time"

// WeekStreak counts consecutive weeks with a ride, ending at the current or
// previous week — riding this Monday keeps last week's streak alive, and a
// streak is not broken mid-week by not having ridden yet (docs/SPEC.md's
// streak bonus counts the current streak, not a lapsed one).
//
// loc decides where the week begins: the rider's own zone for the rider
// streak that pays (#2063), UTC for a room's, which has no one zone.
// `weeks` are already-bucketed week starts — the query truncated them in the
// same loc and they arrive as bare dates — so only `now` is an instant that
// still needs converting.
func WeekStreak(weeks []time.Time, now time.Time, loc *time.Location) int {
	if len(weeks) == 0 {
		return 0
	}
	current := WeekStart(now, loc)
	streak := 0
	expect := current
	for _, week := range weeks {
		w := WeekStart(week, time.UTC)
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
