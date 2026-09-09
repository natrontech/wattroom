package store_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The compose default, tried when WATTROOM_TEST_DB says nothing else.
const defaultTestDSN = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users

func testDSN() string {
	if dsn := os.Getenv("WATTROOM_TEST_DB"); dsn != "" {
		return dsn
	}
	return defaultTestDSN
}

// Needs a running Postgres (make infra) and skips without one, so a bare
// `go test` stays green on a machine with no database. `make test` and CI set
// WATTROOM_REQUIRE_DB, which turns that skip into a failure — see
// TestDatabaseReachableWhenRequired.
func open(t *testing.T) *store.Store {
	t.Helper()
	dsn := testDSN()
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
	st, err := store.Open(ctx, testDSN())
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
