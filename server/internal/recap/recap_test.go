package recap

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// The session every fixture below shares: an hour, ended ten minutes ago.
var (
	sessionEnd   = time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	sessionStart = sessionEnd.Add(-time.Hour)
)

type world struct {
	st    *store.Store
	svc   *Service
	room  db.Room
	users map[string]db.User
}

func setup(t *testing.T) *world {
	t.Helper()
	st := storetest.Open(t)
	w := &world{st: st, svc: New(st, slog.New(slog.DiscardHandler)), users: map[string]db.User{}}
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		w.users[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		// Unique per run: one `go test ./...` shares a database across
		// packages, and a fixed slug collides with whoever ran first (#2083).
		Slug: "recap-cave-" + time.Now().Format("150405.000000"),
		Name: "Recap Cave", OwnerID: w.users["alice"].ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	w.room = room
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	return w
}

// recapRow writes the session every test in this file reads back.
func (w *world) recapRow(t *testing.T) {
	t.Helper()
	riders, err := json.Marshal([]protocol.SessionRecapRider{{
		ID: store.UUIDString(w.users["alice"].ID), Rider: "alice",
		From: sessionStart.UnixMilli(), To: sessionEnd.UnixMilli(), Rode: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.st.Queries.SaveSessionRecap(t.Context(), db.SaveSessionRecapParams{
		RoomID: w.room.ID, Workout: "Sweet Spot 2x20",
		StartedAt: pgtype.Timestamptz{Time: sessionStart, Valid: true},
		EndedAt:   pgtype.Timestamptz{Time: sessionEnd, Valid: true},
		Riders:    riders,
	}); err != nil {
		t.Fatalf("save recap: %v", err)
	}
}

// ride saves one room ride for a rider, started at `at`.
func (w *world) ride(t *testing.T, who string, at time.Time) string {
	t.Helper()
	id, err := w.st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: w.users[who].ID, RoomID: w.room.ID, WorkoutName: "Sweet Spot 2x20",
		StartedAt: pgtype.Timestamptz{Time: at, Valid: true},
		Seconds:   3600, AvgWatts: 180, Kj: 640, Execution: 0.9, ExecutionScored: true,
		FtpWatts: 200, Samples: []byte{}, Curve: []byte(`{}`), Xp: 640,
	})
	if err != nil {
		t.Fatalf("create ride for %s: %v", who, err)
	}
	return store.UUIDString(id)
}

func (w *world) list(t *testing.T, viewer string) protocol.SessionRecap {
	t.Helper()
	rows, err := w.svc.List(t.Context(), w.room.ID, w.users[viewer].ID, 50)
	if err != nil {
		t.Fatalf("list as %s: %v", viewer, err)
	}
	if len(rows) != 1 {
		t.Fatalf("list as %s returned %d recaps, want 1", viewer, len(rows))
	}
	return rows[0]
}

// The card's one per-viewer field (#1560). Everything else on a recap reads
// the same for every member; this is the door to the viewer's OWN numbers, so
// the thing that must never happen is it opening somebody else's ride.
func TestRecapCarriesTheViewersOwnRide(t *testing.T) {
	w := setup(t)
	w.recapRow(t)
	// Both rode it. Bob's ride starts later — he joined ten minutes in.
	aliceRide := w.ride(t, "alice", sessionStart)
	bobRide := w.ride(t, "bob", sessionStart.Add(10*time.Minute))

	if got := w.list(t, "alice").RideID; got != aliceRide {
		t.Errorf("alice's card opens %q, want her own ride %q", got, aliceRide)
	}
	if got := w.list(t, "bob").RideID; got != bobRide {
		t.Errorf("bob's card opens %q, want his own ride %q — a late joiner's ride starts after the session did", got, bobRide)
	}
}

// The coach with no trainer, and the member reading the backlog who was never
// there: no ride, no link, and emphatically not the ride of whoever did ride.
func TestRecapWithoutARideCarriesNoLink(t *testing.T) {
	w := setup(t)
	w.recapRow(t)
	w.ride(t, "alice", sessionStart)

	if got := w.list(t, "bob").RideID; got != "" {
		t.Errorf("bob did not ride, yet his card opens %q", got)
	}
}

// The window is the session's own, not "a ride in this room": last week's
// ride must not turn up on this week's card.
func TestRecapIgnoresRidesOutsideTheSession(t *testing.T) {
	w := setup(t)
	w.recapRow(t)
	for _, when := range []struct {
		name string
		at   time.Time
	}{
		{"a week earlier", sessionStart.Add(-7 * 24 * time.Hour)},
		{"an hour after it ended", sessionEnd.Add(time.Hour)},
		{"two minutes before it started", sessionStart.Add(-2 * time.Minute)},
	} {
		t.Run(when.name, func(t *testing.T) {
			ride := w.ride(t, "alice", when.at)
			if got := w.list(t, "alice").RideID; got == ride {
				t.Errorf("a ride from %s is on the card", when.name)
			}
			_, _ = w.st.Pool.Exec(t.Context(), "delete from rides where id = $1", ride)
		})
	}
}
