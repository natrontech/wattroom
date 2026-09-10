package stats

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// A backfill after the close grows the saved ride (#1536): more seconds,
// more kJ, more xp on the row — and a replay of what was already saved, or a
// shorter record, changes nothing. Medals are not this test's: they stay as
// the close awarded them, which AmendRide never touches.
func TestAmendRideGrowsASavedRideOnlyForward(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: "amend-test", FtpWatts: 250, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID) })
	room, err := st.Queries.CreateRoom(ctx, db.CreateRoomParams{Slug: "amend-test-room", Name: "Amend", OwnerID: user.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID) })

	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	rider := protocol.Rider{ID: store.UUIDString(user.ID), Name: "Amend", FtpWatts: 250, WeightKg: 75}
	samples := func(n int) []protocol.RiderMetrics {
		out := make([]protocol.RiderMetrics, n)
		for i := range out {
			out[i] = protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: i + 1}
		}
		return out
	}
	workoutJSON := `{"name":"W","steps":[{"type":"steady","seconds":600,"target":0.8}]}`
	startedAt := time.Now().Add(-time.Hour).Truncate(time.Second)
	if err := saver.save(ctx, room.Slug, "W", workoutJSON, startedAt, []hub.RiderRecord{{Rider: rider, Samples: samples(70)}}); err != nil {
		t.Fatal(err)
	}
	read := func() (seconds int32, kj int32, xp int32) {
		var s, k, x int32
		if err := st.Pool.QueryRow(ctx, "select seconds, kj, xp from rides where user_id = $1", user.ID).Scan(&s, &k, &x); err != nil {
			t.Fatal(err)
		}
		return s, k, x
	}
	seconds, kj, xp := read()
	if seconds != 70 {
		t.Fatalf("saved %d seconds, want 70", seconds)
	}

	// The tail arrives: the row grows with it.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(130)})
	grown, grownKj, grownXp := read()
	if grown != 130 || grownKj <= kj || grownXp <= xp {
		t.Fatalf("after the tail: %d s, %d kJ, %d xp (was %d s, %d kJ, %d xp)", grown, grownKj, grownXp, seconds, kj, xp)
	}
	// A replay of less than what is saved changes nothing.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(100)})
	if again, _, _ := read(); again != 130 {
		t.Fatalf("a shorter record shrank the ride to %d s", again)
	}
	// And a rider with no ride at that start has nothing to grow.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt.Add(time.Minute), hub.RiderRecord{Rider: rider, Samples: samples(200)})
	var rides int
	if err := st.Pool.QueryRow(ctx, "select count(*) from rides where user_id = $1", user.ID).Scan(&rides); err != nil || rides != 1 {
		t.Fatalf("rides after an amendment with no ride: %d %v", rides, err)
	}
	_ = pgtype.UUID{}
}
