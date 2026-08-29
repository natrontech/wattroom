package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Needs a running Postgres (make infra) and skips without one, so `make test`
// stays green on machines and CI runners that have no database. Set
// WATTROOM_TEST_DB to run it; the compose default is the fallback attempt.
func open(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom" //nolint:gosec // compose dev credentials, same literal as docker-compose.yml
	}
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
