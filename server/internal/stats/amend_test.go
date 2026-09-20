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
	"github.com/natrontech/wattroom/server/internal/testx"
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
	room, err := st.Queries.CreateRoom(ctx, db.CreateRoomParams{Slug: testx.Slug("amend-test-room"), Name: "Amend", OwnerID: user.ID})
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

// StreakXP's contract is written down at its definition: "read before this
// ride lands so this week only counts if already ridden". save gets that for
// free by asking before the insert; an amendment cannot, because the row is
// already in the table — so the ride's own week came back, the streak was
// one higher, and the amended row was written with 25 XP more than the
// identical ride would have earned had the socket not dropped (#2253). It
// hits whenever the amended ride is the rider's first that week, which is
// the common case for a weekly group session.
func TestAnAmendedRideDoesNotPayItsOwnStreak(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: "streak-test", FtpWatts: 250, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID) })
	room, err := st.Queries.CreateRoom(ctx, db.CreateRoomParams{Slug: testx.Slug("streak-test-room"), Name: "Streak", OwnerID: user.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID) })

	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	rider := protocol.Rider{ID: store.UUIDString(user.ID), Name: "Streak", FtpWatts: 250, WeightKg: 75}
	samples := func(n int) []protocol.RiderMetrics {
		out := make([]protocol.RiderMetrics, n)
		for i := range out {
			out[i] = protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: i + 1}
		}
		return out
	}
	workoutJSON := `{"name":"W","steps":[{"type":"steady","seconds":600,"target":0.8}]}`
	startedAt := time.Now().Add(-time.Hour).Truncate(time.Second)
	xpOf := func() int32 {
		t.Helper()
		var xp int32
		if err := st.Pool.QueryRow(ctx, "select xp from rides where user_id = $1", user.ID).Scan(&xp); err != nil {
			t.Fatal(err)
		}
		return xp
	}

	// The rider's first ride of the week: the save pays no streak bonus,
	// because the week only counts once it has already been ridden.
	if err := saver.save(ctx, room.Slug, "W", workoutJSON, startedAt, []hub.RiderRecord{{Rider: rider, Samples: samples(70)}}); err != nil {
		t.Fatal(err)
	}
	saved := xpOf()

	// The tail arrives. The ride is longer, so it is worth more — but not by
	// a streak week it did not have. StreakBonus(1) is 25, which is the
	// difference this used to grow by on top of the seconds.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(140)})
	amended := xpOf()
	if amended <= saved {
		t.Fatalf("the amended ride is worth %d, was %d — it grew, so it should be worth more", amended, saved)
	}
	// What the same ride would have been worth had it been saved whole: the
	// row goes, and the identical record is saved in one piece.
	if _, err := st.Pool.Exec(ctx, "delete from rides where user_id = $1", user.ID); err != nil {
		t.Fatal(err)
	}
	if err := saver.save(ctx, room.Slug, "W", workoutJSON, startedAt, []hub.RiderRecord{{Rider: rider, Samples: samples(140)}}); err != nil {
		t.Fatal(err)
	}
	if whole := xpOf(); amended != whole {
		t.Errorf("amended to 140 s is worth %d xp, saved whole at 140 s is worth %d — a dropped socket must not pay more", amended, whole)
	}
}

// fakeKeeper is the trophy case: what it was asked to judge, in order.
type fakeKeeper struct{ judged []RideFacts }

func (k *fakeKeeper) RideSaved(_ pgtype.UUID, facts RideFacts) {
	k.judged = append(k.judged, facts)
}

// The tail is part of the ride, so the ride is judged on all of it (#2252).
// stats/facts.go: "Rides store no zone seconds, so this is the only moment
// they exist" — AmendRide rebuilt the row and told nobody, so a ride that
// grew from under the sufferfest line to over it silently missed its trophy
// and there was no second chance to notice, ever.
func TestAnAmendedRideIsJudgedOnTheWholeRide(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: "rejudge-test", FtpWatts: 200, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID) })
	room, err := st.Queries.CreateRoom(ctx, db.CreateRoomParams{Slug: testx.Slug("rejudge-test-room"), Name: "Rejudge", OwnerID: user.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID) })

	keeper := &fakeKeeper{}
	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	saver.SetRideKeeper(keeper)
	rider := protocol.Rider{ID: store.UUIDString(user.ID), Name: "Rejudge", FtpWatts: 200, WeightKg: 75}
	// Every sample is above FTP, so the seconds the trophies are judged on
	// are the seconds of the ride.
	samples := func(n int) []protocol.RiderMetrics {
		out := make([]protocol.RiderMetrics, n)
		for i := range out {
			out[i] = protocol.RiderMetrics{Watts: 240, Cadence: 90, Seq: i + 1}
		}
		return out
	}
	workoutJSON := `{"name":"W","steps":[{"type":"steady","seconds":600,"target":0.8}]}`
	startedAt := time.Now().Add(-time.Hour).Truncate(time.Second)
	if err := saver.save(ctx, room.Slug, "W", workoutJSON, startedAt, []hub.RiderRecord{{Rider: rider, Samples: samples(70)}}); err != nil {
		t.Fatal(err)
	}
	if len(keeper.judged) != 1 || keeper.judged[0].AboveFtpSec != 70 {
		t.Fatalf("the close judged %+v, want one ride of 70 s above FTP", keeper.judged)
	}

	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(130)})
	if len(keeper.judged) != 2 {
		t.Fatalf("the grown ride was judged %d times, want a second look", len(keeper.judged))
	}
	if got := keeper.judged[1]; got.AboveFtpSec != 130 || got.Seconds != 130 {
		t.Errorf("re-judged on %+v, want the whole 130 s", got)
	}

	// A replay that grows nothing is not a second judging: the trophy case
	// is idempotent, but asking it about a ride that did not change is noise.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(100)})
	if len(keeper.judged) != 2 {
		t.Errorf("a shorter replay asked the trophy case again: %+v", keeper.judged)
	}
	// And so is an amendment with no ride to grow.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt.Add(time.Minute), hub.RiderRecord{Rider: rider, Samples: samples(200)})
	if len(keeper.judged) != 2 {
		t.Errorf("an amendment with no ride judged something: %+v", keeper.judged)
	}
}

// Strava keeps the ride as it stood at the close, and the rider is told
// (#2281). A delivery that already succeeded is never re-opened —
// StartRideExport's `where state <> 'delivered'` — and the upload API has no
// update to re-post through, so the two copies diverge for good. The mark is
// the whole notice: without it the ride page says "On Strava as activity N"
// about an activity that is minutes shorter than the ride beside it, which
// is a silent lie rather than a visible failure.
//
// A delivery still PENDING is the case the guard exists for: the upload that
// follows carries the grown ride, so marking it would tell the rider their
// Strava copy is short when it is about to be complete.
func TestAnAmendedRideMarksADeliveredExportStale(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: "stale-test", FtpWatts: 250, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID) })
	room, err := st.Queries.CreateRoom(ctx, db.CreateRoomParams{Slug: testx.Slug("stale-test-room"), Name: "Stale", OwnerID: user.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID) })

	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	rider := protocol.Rider{ID: store.UUIDString(user.ID), Name: "Stale", FtpWatts: 250, WeightKg: 75}
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
	var rideID pgtype.UUID
	if err := st.Pool.QueryRow(ctx, "select id from rides where user_id = $1", user.ID).Scan(&rideID); err != nil {
		t.Fatal(err)
	}
	// The sweep opens the delivery; nothing has reached the destination yet.
	if err := st.Queries.StartRideExport(ctx, db.StartRideExportParams{RideID: rideID, Destination: "strava"}); err != nil {
		t.Fatal(err)
	}
	staleSince := func() pgtype.Timestamptz {
		row, err := st.Queries.GetRideExport(ctx, db.GetRideExportParams{RideID: rideID, Destination: "strava"})
		if err != nil {
			t.Fatal(err)
		}
		return row.StaleSince
	}

	// Grown while the upload is still owed: the upload will carry all of it.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(100)})
	if staleSince().Valid {
		t.Fatalf("a ride amended before its delivery was marked stale")
	}

	// It arrives. The number is this test's own invention: no payload from
	// the destination is ever fixtured in this repository (AGENTS.md).
	remoteID := int64(4242424242)
	if err := st.Queries.FinishRideExport(ctx, db.FinishRideExportParams{
		RideID: rideID, Destination: "strava", RemoteID: &remoteID,
	}); err != nil {
		t.Fatal(err)
	}
	if staleSince().Valid {
		t.Fatalf("a delivery was stale the moment it landed")
	}

	// A replay of what is already saved grows nothing, so the copy out there
	// is still the whole ride.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(80)})
	if staleSince().Valid {
		t.Fatalf("a replay that grew nothing marked the delivery stale")
	}

	// And the tail that arrives late: the ride grows, the destination's copy
	// does not, and the row remembers the moment they came apart.
	saver.AmendRide(ctx, room.Slug, "W", workoutJSON, startedAt, hub.RiderRecord{Rider: rider, Samples: samples(130)})
	if !staleSince().Valid {
		t.Fatalf("the ride outgrew a delivered export and nothing recorded it")
	}
}
