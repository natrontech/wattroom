package wardrobe

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The Swiss calendar (#3163, ADR-0069): eight windows a year, each back every
// year with the same item, so missing one costs a year's wait and never the
// item. docs/SPEC.md "Wardrobe" holds the numbers.
const (
	// seasonRides is how many rides inside a window earn its item.
	seasonRides = 3
	// seasonReach is the days either side of a window's day.
	seasonReach = 3
)

// season is one window: the key its items unlock by ("earned:season:<key>")
// and its first and last day in a year, as UTC midnights. No window crosses
// New Year, so a ride's own year names the window it can fall in.
type season struct {
	key  string
	days func(year int) (first, last time.Time)
}

var seasons = []season{
	{"fasnacht", around(morgestraich)},
	{"chalandamarz", around(on(time.March, 1))},
	{"sechselaeuten", around(sechselaeuten)},
	{"summer-solstice", around(on(time.June, 21))},
	{"1-august", around(on(time.August, 1))},
	{"alpabzug", func(y int) (time.Time, time.Time) { return day(y, time.September, 1), day(y, time.October, 31) }},
	{"samichlaus", around(on(time.December, 6))},
	{"winter-solstice", around(on(time.December, 21))},
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func on(m time.Month, d int) func(int) time.Time {
	return func(y int) time.Time { return day(y, m, d) }
}

// around is the week centred on a day.
func around(of func(int) time.Time) func(int) (time.Time, time.Time) {
	return func(y int) (time.Time, time.Time) {
		d := of(y)
		return d.AddDate(0, 0, -seasonReach), d.AddDate(0, 0, seasonReach)
	}
}

// easter is Easter Sunday in the Gregorian calendar (the anonymous
// Gregorian algorithm).
func easter(y int) time.Time {
	a, b, c := y%19, y/100, y%100
	d, e := b/4, b%4
	g := (b - (b+8)/25 + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	n := h + l - 7*m + 114
	return day(y, time.Month(n/31), n%31+1)
}

// morgestraich is the Monday Basel's Fasnacht starts on: the one after Ash
// Wednesday.
func morgestraich(y int) time.Time { return easter(y).AddDate(0, 0, -41) }

// sechselaeuten is Zurich's Sechseläuten Monday: the third in April, a week
// earlier when that falls in Holy Week and a week later on Easter Monday.
func sechselaeuten(y int) time.Time {
	d := day(y, time.April, 15)
	for d.Weekday() != time.Monday {
		d = d.AddDate(0, 0, 1)
	}
	switch e := easter(y); {
	case d.Equal(e.AddDate(0, 0, -6)):
		return d.AddDate(0, 0, -7)
	case d.Equal(e.AddDate(0, 0, 1)):
		return d.AddDate(0, 0, 7)
	}
	return d
}

// windowsHolding is every season whose window holds the day t falls on in
// t's own location, with that window as instants: [from, to).
func windowsHolding(t time.Time) []window {
	date := day(t.Year(), t.Month(), t.Day())
	var in []window
	for _, s := range seasons {
		first, last := s.days(t.Year())
		if date.Before(first) || date.After(last) {
			continue
		}
		in = append(in, window{s.key,
			time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, t.Location()),
			time.Date(last.Year(), last.Month(), last.Day()+1, 0, 0, 0, 0, t.Location()),
		})
	}
	return in
}

type window struct {
	key      string
	from, to time.Time
}

// seasonItems are the catalogue's items each season unlocks.
var seasonItems = func() map[string][]string {
	m := map[string][]string{}
	for _, it := range items {
		if key, ok := strings.CutPrefix(it.Unlock, "earned:season:"); ok {
			m[key] = append(m[key], it.ID)
		}
	}
	return m
}()

// earnSeasons gives the rider a season's items once the ride saved is at
// least the third they started inside that season's window this year. start
// is the ride's start in the rider's own zone: the window is their calendar's.
// An item already owned keeps the day it was first earned.
func earnSeasons(ctx context.Context, q *db.Queries, user pgtype.UUID, start time.Time) error {
	for _, w := range windowsHolding(start) {
		n, err := q.CountRidesStartedBetween(ctx, db.CountRidesStartedBetweenParams{
			UserID: user,
			FromAt: pgtype.Timestamptz{Time: w.from, Valid: true},
			ToAt:   pgtype.Timestamptz{Time: w.to, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("wardrobe: season %s: %w", w.key, err)
		}
		if n < seasonRides {
			continue
		}
		for _, id := range seasonItems[w.key] {
			if err := q.EarnWardrobeItem(ctx, db.EarnWardrobeItemParams{
				UserID: user, ItemID: id, AcquiredAt: pgtype.Timestamptz{Time: start, Valid: true},
			}); err != nil {
				return fmt.Errorf("wardrobe: earn %s: %w", id, err)
			}
		}
	}
	return nil
}
