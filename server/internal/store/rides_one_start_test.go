package store

// The duplicate-resolution half of 20260910145218_rides_one_start_per_rider
// cannot be tested on a migrated database: the index it adds is exactly what
// stops the rows it resolves from being written. So this migrates a scratch
// database to the release before it, writes the world the constraint was
// never able to refuse — one rider, two rides, one start — and migrates over
// it. The cutover test next door explains why the scratch database.

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// The migration that adds `unique (user_id, started_at)`. UpTo stops one
// short of it, whatever else lands in between.
const oneStartPerRiderVersion int64 = 20260910145218

// TestTheUniqueStartKeepsBothRides is the decision in #2064 written down as a
// test: a duplicate pair predating the constraint keeps BOTH rides, nudged
// microseconds apart. Deleting one would need the offsetting `ride_deleted`
// ledger row ADR-0047 requires — a raw delete drops a rider's level on deploy
// — and would be guessing which of two indistinguishable rows was ridden.
func TestTheUniqueStartKeepsBothRides(t *testing.T) {
	dsn := scratchDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("scratch pool: %v", err)
	}
	defer pool.Close()

	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	sqldb := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqldb.Close() }()

	if err := goose.UpToContext(ctx, sqldb, "migrations", oneStartPerRiderVersion-1); err != nil {
		t.Fatalf("migrate to the release before the constraint: %v", err)
	}

	var rider, other string
	for _, u := range []struct {
		name string
		into *string
	}{{"Duplicated", &rider}, {"Neighbour", &other}} {
		if err := pool.QueryRow(ctx,
			`insert into users (display_name) values ($1) returning id`, u.name).Scan(u.into); err != nil {
			t.Fatalf("%s: %v", u.name, err)
		}
	}

	start := time.Date(2026, 9, 1, 18, 30, 0, 0, time.UTC)
	// Three rows on one start for one rider — a save that raced itself twice
	// — plus a fourth on the same start for somebody else, which is not a
	// duplicate at all and must be left exactly where it is.
	for _, r := range []struct {
		user string
		name string
	}{{rider, "Openers"}, {rider, "Openers"}, {rider, "Openers"}, {other, "Threshold"}} {
		if _, err := pool.Exec(ctx,
			`insert into rides (user_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
			 values ($1, $2, $3, 600, 200, 120, 1, 250, '\x00'::bytea)`,
			r.user, r.name, start); err != nil {
			t.Fatalf("seed ride: %v", err)
		}
	}

	if err := goose.UpContext(ctx, sqldb, "migrations"); err != nil {
		t.Fatalf("migrate over a duplicated start: %v", err)
	}

	t.Run("no ride is lost", func(t *testing.T) {
		var mine, theirs int
		if err := pool.QueryRow(ctx,
			`select count(*) filter (where user_id = $1), count(*) filter (where user_id = $2) from rides`,
			rider, other).Scan(&mine, &theirs); err != nil {
			t.Fatalf("count: %v", err)
		}
		if mine != 3 {
			t.Fatalf("the rider has %d of 3 rides — the migration deleted one", mine)
		}
		if theirs != 1 {
			t.Fatalf("the neighbour has %d of 1 rides", theirs)
		}
	})

	t.Run("the starts are distinct and within a millisecond of the original", func(t *testing.T) {
		rows, err := pool.Query(ctx,
			`select started_at from rides where user_id = $1 order by started_at`, rider)
		if err != nil {
			t.Fatalf("starts: %v", err)
		}
		defer rows.Close()
		var starts []time.Time
		for rows.Next() {
			var at time.Time
			if err := rows.Scan(&at); err != nil {
				t.Fatalf("scan: %v", err)
			}
			starts = append(starts, at)
		}
		for i, at := range starts {
			if i > 0 && !at.After(starts[i-1]) {
				t.Fatalf("starts %v and %v are not distinct — the index cannot have built", starts[i-1], at)
			}
			// A microsecond nudge is below every precision the app shows or
			// sends; a resolution that moved a ride by a visible amount
			// would be rewriting when the rider rode.
			if d := at.Sub(start); d < 0 || d > time.Millisecond {
				t.Fatalf("a ride moved by %v, which a rider can see", d)
			}
		}
	})

	t.Run("a second ride at the same start is now refused", func(t *testing.T) {
		if _, err := pool.Exec(ctx,
			`insert into rides (user_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
			 values ($1, 'Racing insert', $2, 600, 200, 120, 1, 250, '\x00'::bytea)`,
			rider, start); err == nil {
			t.Fatal("the duplicate inserted — the unique index is missing")
		}
	})
}
