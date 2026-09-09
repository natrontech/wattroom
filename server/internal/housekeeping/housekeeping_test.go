package housekeeping_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/housekeeping"
	"github.com/natrontech/wattroom/server/internal/recap"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// Both sweeps fail SILENTLY: nothing errors, rows simply stay. So each test
// asserts the row is gone from the TABLE rather than that some reader declines
// to return it — an expired session is already rejected by GetSessionUser, and
// that is exactly why #1163 went unnoticed for so long.

func open(t *testing.T) *store.Store {
	t.Helper()
	st := storetest.Open(t)
	return st
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func user(t *testing.T, st *store.Store) db.User {
	t.Helper()
	u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "sweeper", FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	return u
}

func stamp(at time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: at, Valid: true}
}

func TestSweepDeletesExpiredSessionsAndKeepsLiveOnes(t *testing.T) {
	st := open(t)
	u := user(t, st)

	dead := []byte("housekeeping-expired-session-hash")
	live := []byte("housekeeping-live-session-hash")
	for _, s := range []struct {
		hash    []byte
		expires time.Time
	}{{dead, time.Now().Add(-time.Hour)}, {live, time.Now().Add(time.Hour)}} {
		if err := st.Queries.CreateSession(t.Context(), db.CreateSessionParams{
			TokenHash: s.hash, UserID: u.ID, ExpiresAt: stamp(s.expires),
		}); err != nil {
			t.Fatalf("create session: %v", err)
		}
	}
	count := func(h []byte) int {
		var n int
		if err := st.Pool.QueryRow(t.Context(),
			"select count(*) from sessions where token_hash = $1", h).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		return n
	}
	if count(dead) != 1 || count(live) != 1 {
		t.Fatal("both sessions should exist before the sweep — test proves nothing")
	}

	housekeeping.Once(t.Context(), st, quiet())

	if count(dead) != 0 {
		t.Error("an expired session survived the sweep")
	}
	if count(live) != 1 {
		t.Error("the sweep took a session that had not expired")
	}
}

// The case #1153 is about: no session ends, so no write is triggered, and the
// recap has to age out on the clock alone.
func TestSweepPrunesRecapsPastRetentionWithoutAWrite(t *testing.T) {
	st := open(t)
	u := user(t, st)
	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "housekeeping-recaps", Name: "Housekeeping", OwnerID: u.ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})

	stale := time.Now().Add(-(recap.RetentionDays + 1) * 24 * time.Hour)
	fresh := time.Now().Add(-24 * time.Hour)
	for _, at := range []time.Time{stale, fresh} {
		if _, err := st.Queries.SaveSessionRecap(t.Context(), db.SaveSessionRecapParams{
			RoomID: room.ID, Workout: "Sweet Spot", StartedAt: stamp(at), EndedAt: stamp(at),
			Riders: []byte(`[]`),
		}); err != nil {
			t.Fatalf("save recap: %v", err)
		}
	}
	left := func() int {
		var n int
		if err := st.Pool.QueryRow(t.Context(),
			"select count(*) from session_recaps where room_id = $1", room.ID).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		return n
	}
	if left() != 2 {
		t.Fatalf("expected both recaps before the sweep, got %d — test proves nothing", left())
	}

	housekeeping.Once(t.Context(), st, quiet())

	if n := left(); n != 1 {
		t.Errorf("after the sweep %d recaps remain, want 1 (the one inside retention)", n)
	}
}

// A failing sweep is logged, never fatal: they share a schedule and nothing
// else, and a housekeeping error must not be able to take the server down.
func TestAFailingSweepIsSurvivable(t *testing.T) {
	st := open(t)
	st.Close()
	housekeeping.Once(t.Context(), st, quiet())
}
