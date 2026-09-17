package store_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/jackc/pgx/v5/pgtype"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver, for goose's own API below
	"github.com/pressly/goose/v3"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// Needs a running Postgres (make infra) and skips without one, so a bare
// `go test` stays green on a machine with no database. `make test` and CI set
// WATTROOM_REQUIRE_DB, which turns that skip into a failure — see
// TestDatabaseReachableWhenRequired.
func open(t *testing.T) *store.Store {
	t.Helper()
	dsn := storetest.DSN()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}

// One flow through every table: migrations apply, FKs hold, and a ride's blob
// comes back byte-identical. Table-per-query unit tests would only re-test sqlc.
func TestRoundTrip(t *testing.T) {
	st := open(t)
	ctx := context.Background()

	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{
		DisplayName: "roundtrip", FtpWatts: 265, WeightKg: 80,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	// The test writes real rows; the user row's cascade is the cleanup.
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, "delete from users where id = $1", user.ID)
	})

	samples := []byte("not-really-gzip-but-bytes")
	rideID, err := st.Queries.CreateRide(ctx, db.CreateRideParams{
		UserID: user.ID, WorkoutName: "Openers",
		StartedAt: pgNow(), Seconds: 120, AvgWatts: 210,
		Kj: 25, Execution: 0.97, FtpWatts: 265, Samples: samples,
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}

	ride, err := st.Queries.GetRide(ctx, db.GetRideParams{ID: rideID, UserID: user.ID})
	if err != nil {
		t.Fatalf("get ride: %v", err)
	}
	if string(ride.Samples) != string(samples) {
		t.Fatalf("samples blob did not round-trip")
	}
	if ride.SharedAt.Valid {
		t.Fatalf("a new ride must be private by default")
	}

	// The ADR-0008 purge path: deleting the user must take the ride's blob.
	if _, err := st.Pool.Exec(ctx, "delete from users where id = $1", user.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	if _, err := st.Queries.GetRide(ctx, db.GetRideParams{ID: rideID, UserID: user.ID}); err == nil {
		t.Fatalf("ride survived its owner's deletion — the purge cascade is broken")
	}
}

func TestConstraintsRejectJunk(t *testing.T) {
	st := open(t)
	ctx := context.Background()

	// Bounds live in the schema, not only in whoever validates the request.
	_, err := st.Queries.CreateUser(ctx, db.CreateUserParams{
		DisplayName: "junk", FtpWatts: 9000, WeightKg: 80,
	})
	if err == nil {
		t.Fatalf("an FTP of 9000 W got past the schema")
	}
}

func pgNow() (ts pgtype.Timestamptz) {
	ts.Time = time.Now().UTC()
	ts.Valid = true
	return ts
}

// A suite that skips its way to green is worse than a red one. Seventeen
// packages here open the test database and skip when they cannot, so an
// unreachable one leaves `go test ./...` printing `ok` for every package
// having run essentially nothing — which is how a worktree whose Postgres
// container was never found reported a passing suite (#814).
//
// WATTROOM_REQUIRE_DB is set by `make test` and by CI, whose Postgres service
// exists for exactly this. Without it a bare `go test` still skips.
func TestDatabaseReachableWhenRequired(t *testing.T) {
	if os.Getenv("WATTROOM_REQUIRE_DB") != "1" {
		t.Skip("WATTROOM_REQUIRE_DB is not set — `make test` and CI set it")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, storetest.DSN())
	if err != nil {
		t.Fatalf("no test database, so every DB-backed package would skip and the suite would still say ok — run `make infra` here, or set WATTROOM_TEST_DB: %v", err)
	}
	st.Close()
}

// A database that is not there is a different answer from one that answered
// and refused, and the test helpers skip on the first only (storetest.Open).
func TestOpenSaysWhenTheDatabaseIsUnreachable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := store.Open(ctx, "postgres://wattroom:wattroom@127.0.0.1:1/nowhere?connect_timeout=1")
	if !errors.Is(err, store.ErrUnreachable) {
		t.Fatalf("an unreachable database did not say so: %v", err)
	}
}

// Concurrent opens of one FRESH database must all succeed: `go test ./...`
// opens the shared test database from every package at once, and goose
// racing itself failed with "relation already exists" on one CI run in
// three (2026-09-09). The database is created here, so the migrations
// genuinely run for the first time under the race.
func TestConcurrentOpensMigrateOnce(t *testing.T) {
	dsn := freshDatabase(t, "race")

	const openers = 8
	errs := make(chan error, openers)
	for range openers {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			st, err := store.Open(ctx, dsn)
			if err == nil {
				st.Close()
			}
			errs <- err
		}()
	}
	for range openers {
		if err := <-errs; err != nil {
			t.Errorf("a concurrent open failed: %v", err)
		}
	}
}

// A migration written before one the database already holds must be applied,
// not refused (#1481). Two branches stamped timestamps a minute apart on
// 2026-09-09; the later-written one merged first, and every database that had
// taken it rejected the other at boot. On a laptop that costs a dropped
// database; in production it is the health gate rolling the release back until
// somebody edits goose_db_version by hand. ADR-0019's expand-only rule is what
// makes applying one late safe, and goose.WithAllowMissing is what does it.
//
// The fixture writes a version above every migration file into a FRESH
// database's goose_db_version — the neighbour's file, merged first — which
// leaves every real migration "missing": goose's word for one whose version is
// below the recorded maximum and which has never run. Same code path and same
// refusal as the incident, and it stays honest whatever lands in migrations/
// next; leaving one real migration out of the middle instead would mean
// unwinding that one file's SQL by hand.
func TestOpenAppliesAMigrationThatArrivedLate(t *testing.T) {
	dsn := freshDatabase(t, "late_migration")
	ours := migrationVersions(t)
	neighbour := ours[len(ours)-1] + 1

	seedVersion(t, dsn, neighbour)

	st, err := store.Open(t.Context(), dsn)
	if err != nil {
		t.Fatalf("a database already holding version %d refused this branch's older migrations, "+
			"which is the boot goose.WithAllowMissing exists to allow: %v", neighbour, err)
	}
	t.Cleanup(st.Close)

	recorded := map[int64]bool{}
	rows, err := st.Pool.Query(t.Context(), "select version_id from goose_db_version where is_applied")
	if err != nil {
		t.Fatalf("read goose_db_version: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			t.Fatalf("scan version: %v", err)
		}
		recorded[v] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read goose_db_version: %v", err)
	}
	for _, v := range ours {
		if !recorded[v] {
			t.Errorf("migration %d was skipped rather than applied late", v)
		}
	}

	// Recorded is not applied: the schema itself has to be there.
	var users int
	if err := st.Pool.QueryRow(t.Context(), "select count(*) from users").Scan(&users); err != nil {
		t.Fatalf("the migrations were recorded but their schema is missing: %v", err)
	}
}

// freshDatabase creates an empty database of its own and returns its DSN.
// Migration behaviour cannot be tested against the shared test database: that
// one is already migrated, and these tests are about the way there. The name
// carries the whole nanosecond so two of them in one run cannot collide
// (#2083).
func freshDatabase(t *testing.T, purpose string) string {
	t.Helper()
	base := storetest.DSN()
	server := strings.TrimRight(base[:strings.LastIndex(base, "/")], "/")
	admin, err := pgx.Connect(t.Context(), server+"/postgres")
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	name := fmt.Sprintf("wattroom_test_%s_%d", purpose, time.Now().UnixNano())
	if _, err := admin.Exec(t.Context(), "create database "+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "drop database if exists "+name+" with (force)")
	})
	return server + "/" + name
}

// migrationVersions lists this branch's migration versions, ascending.
func migrationVersions(t *testing.T) []int64 {
	t.Helper()
	entries, err := os.ReadDir("migrations")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	var versions []int64
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		version, _, _ := strings.Cut(name, "_")
		n, err := strconv.ParseInt(version, 10, 64)
		if err != nil {
			t.Fatalf("%s: %v — TestMigrationVersionsAreUnique has the naming rule", name, err)
		}
		versions = append(versions, n)
	}
	if len(versions) == 0 {
		t.Fatal("no migrations found")
	}
	slices.Sort(versions)
	return versions
}

// seedVersion records version as applied in an otherwise empty database, the
// way a neighbour's migration that merged first would have. goose owns the
// version table's shape, so goose creates it rather than a copy of its DDL.
func seedVersion(t *testing.T, dsn string, version int64) {
	t.Helper()
	// Never the dsn in the message: it carries the database's password.
	sqldb, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open the seeded database: %v", err)
	}
	defer func() { _ = sqldb.Close() }()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	if _, err := goose.EnsureDBVersionContext(t.Context(), sqldb); err != nil {
		t.Fatalf("create goose_db_version: %v", err)
	}
	if _, err := sqldb.ExecContext(t.Context(),
		"insert into goose_db_version (version_id, is_applied) values ($1, true)", version); err != nil {
		t.Fatalf("record version %d: %v", version, err)
	}
}
