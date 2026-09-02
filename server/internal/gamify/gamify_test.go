package gamify

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

// setup opens the test database (skipping without one) and returns a
// service over it plus two riders, alice and bob, deleted on cleanup.
func setup(t *testing.T) (*Service, *fakeUsers, db.User, db.User) {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

	users := &fakeUsers{byToken: map[string]db.User{}}
	newUser := func(name string) db.User {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 250, WeightKg: 70,
		})
		if err != nil {
			t.Fatalf("create user: %v", err)
		}
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
		users.byToken[name] = u
		return u
	}
	alice, bob := newUser("alice"), newUser("bob")
	s := New(st, users, slog.New(slog.DiscardHandler))
	return s, users, alice, bob
}

func addRide(t *testing.T, s *Service, user db.User, startedAt time.Time, seconds, kj, xp int) {
	t.Helper()
	curve, _ := json.Marshal(map[string]int{"best5s": 500, "best1m": 350, "best5m": 300, "best20m": 260})
	_, err := s.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "test ride",
		StartedAt: pgtype.Timestamptz{Time: startedAt, Valid: true},
		Seconds:   int32(seconds), AvgWatts: 200, Kj: int32(kj), Execution: 0.9, FtpWatts: user.FtpWatts, //nolint:gosec // test values
		Samples: []byte("x"), Curve: curve, Xp: int32(xp), //nolint:gosec // test values
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}
}

func sources(t *testing.T, s *Service, user db.User) map[string]db.XpBySourceRow {
	t.Helper()
	rows, err := s.store.Queries.XpBySource(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("xp by source: %v", err)
	}
	out := make(map[string]db.XpBySourceRow, len(rows))
	for _, row := range rows {
		out[row.Source] = row
	}
	return out
}

func earned(t *testing.T, s *Service, user db.User) map[string]bool {
	t.Helper()
	rows, err := s.store.Queries.ListUserAchievements(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("achievements: %v", err)
	}
	out := make(map[string]bool, len(rows))
	for _, row := range rows {
		out[row.Key] = true
	}
	return out
}
