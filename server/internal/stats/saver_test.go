package stats

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"testing/synctest"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

var errDown = errors.New("postgres down")

func TestRetrySave(t *testing.T) {
	tests := []struct {
		name        string
		failures    int // attempts that fail before success
		wantCalls   int
		wantErr     bool
		wantElapsed time.Duration // backoff waits only; save returns instantly
	}{
		{"first try", 0, 1, false, 0},
		{"recovers after two failures", 2, 3, false, 3 * time.Second},
		{"gives up after saveAttempts", saveAttempts, saveAttempts, true, 127 * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				calls := 0
				start := time.Now()
				err := retrySave(context.Background(), slog.New(slog.DiscardHandler), "test",
					func(context.Context) error {
						calls++
						if calls <= tt.failures {
							return errDown
						}
						return nil
					})
				if (err != nil) != tt.wantErr {
					t.Fatalf("err = %v, want error %v", err, tt.wantErr)
				}
				if calls != tt.wantCalls {
					t.Fatalf("calls = %d, want %d", calls, tt.wantCalls)
				}
				if elapsed := time.Since(start); elapsed != tt.wantElapsed {
					t.Fatalf("elapsed = %v, want %v", elapsed, tt.wantElapsed)
				}
			})
		})
	}
}

func TestRetrySaveStopsOnCancel(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		calls := 0
		done := make(chan error, 1)
		go func() {
			done <- retrySave(ctx, slog.New(slog.DiscardHandler), "test",
				func(context.Context) error {
					calls++
					return errDown
				})
		}()
		synctest.Wait() // retrySave is parked in its first backoff wait
		cancel()
		if err := <-done; !errors.Is(err, errDown) {
			t.Fatalf("err = %v, want the last save error", err)
		}
		if calls != 1 {
			t.Fatalf("calls = %d, want 1 — cancel must stop further attempts", calls)
		}
	})
}

// The streak that pays is the rider's own, never the room's (#1451,
// docs/SPEC.md glossary). WeekStreak and StreakBonus are both tested; the
// choice of input was not, which is how the room's number and the paid
// number drifted apart in the docs. A newcomer to a six-week room is paid
// for their own first week, so this pins StreakXP to ListUserRideWeeks:
// swap it to ListRoomRideWeeks and the newcomer's 25 becomes 150.
func TestStreakXPPaysTheRidersOwnWeeksNotTheRooms(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	newUser := func(name string) pgtype.UUID {
		t.Helper()
		u, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: name, FtpWatts: 250, WeightKg: 75})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
		return u.ID
	}
	regular := newUser("streak-input-regular")
	newcomer := newUser("streak-input-newcomer")
	// wattroom_test is shared and rooms.slug is globally unique: a run killed
	// before its cleanup must not wedge every later one.
	slug := fmt.Sprintf("streak-input-room-%d", time.Now().UnixNano())
	room, err := st.Queries.CreateRoom(ctx, db.CreateRoomParams{Slug: slug, Name: "Streak input", OwnerID: regular})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID) })

	now := time.Now().UTC()
	ride := func(user pgtype.UUID, weeksAgo int) {
		t.Helper()
		if _, err := st.Queries.CreateRide(ctx, db.CreateRideParams{
			UserID: user, RoomID: room.ID, WorkoutName: "W",
			StartedAt: pgtype.Timestamptz{Time: now.AddDate(0, 0, -7*weeksAgo), Valid: true},
			Seconds:   600, AvgWatts: 200, Kj: 120, Execution: 1, ExecutionScored: true,
			FtpWatts: 250, Samples: []byte{}, Curve: []byte("[]"),
		}); err != nil {
			t.Fatal(err)
		}
	}
	// The room has run for six straight weeks, all of them the regular's.
	for w := range 6 {
		ride(regular, w)
	}
	// The newcomer's first ride is this week, in that same room.
	ride(newcomer, 0)

	roomWeeks, err := st.Queries.ListRoomRideWeeks(ctx, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	times := make([]time.Time, len(roomWeeks))
	for i, w := range roomWeeks {
		times[i] = w.Time
	}
	if got := WeekStreak(times, now); got != 6 {
		t.Fatalf("the room's streak = %d weeks, want 6 — the fixture is wrong, not StreakXP", got)
	}

	if got := StreakXP(ctx, st.Queries, newcomer, now); got != 25 {
		t.Fatalf("StreakXP for a first-week rider in a six-week room = %d, want 25 (their own one week); "+
			"%d would mean it is reading the room's streak", got, StreakBonus(6))
	}
	if got := StreakXP(ctx, st.Queries, regular, now); got != 150 {
		t.Fatalf("StreakXP for the six-week rider = %d, want 150", got)
	}
}
