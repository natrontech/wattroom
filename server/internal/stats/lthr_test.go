package stats

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// lthrFixture is one fresh rider. The test database is per-checkout, not
// per-run and not per-package (#2083), so every assertion is scoped to this
// user's id.
func lthrFixture(t *testing.T) (context.Context, *store.Store, db.User) {
	t.Helper()
	st := storetest.Open(t)
	// t.Context, not Background: a query that hangs fails this test rather
	// than the package's timeout.
	ctx := t.Context()
	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: "lthr-test", FtpWatts: 250, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID) })
	return ctx, st, user
}

// putRide stores one ride with an explicit last20m_hr, place and length. The
// zero place is a solo ride.
func putRide(t *testing.T, ctx context.Context, st *store.Store, userID pgtype.UUID,
	at place, name string, ago time.Duration, seconds int32, hr int16,
) pgtype.UUID {
	t.Helper()
	id, err := st.Queries.CreateRide(ctx, db.CreateRideParams{
		UserID: userID, CrewID: at.crew, ChannelID: at.channel, SessionID: at.session, WorkoutName: name,
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-ago), Valid: true},
		Seconds:   seconds, AvgWatts: 200, Kj: 300, Execution: 0.9, FtpWatts: 250,
		Samples: []byte("{}"), Curve: []byte(`{}`), Xp: 10, Last20mHr: &hr,
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// docs/SPEC.md's qualification, and nothing else: solo, at least 30 minutes,
// a heart rate in the window, inside the rolling 90 days. Each exclusion here
// is silent if it breaks — a crew ride or a 12-minute blast would just quietly
// become the number the rider is asked to adopt as their threshold.
func TestBestLast20mHRIn90DaysTakesOnlyQualifyingRides(t *testing.T) {
	ctx, st, user := lthrFixture(t)
	crew := testx.Crew(t, st, "LTHR", user.ID)
	voice, err := store.ParseUUID(testx.Voice(t, st, crew, "LTHR", false))
	if err != nil {
		t.Fatal(err)
	}

	var solo place // nowhere: a solo ride (BuildRideRow)
	// The only ride that qualifies, and the lowest number of the lot.
	putRide(t, ctx, st, user.ID, solo, "Field test", time.Hour, MinLTHRRideSeconds, 164)
	// Each of these carries a HIGHER number and must not be the answer.
	putRide(t, ctx, st, user.ID, place{crew: crew, channel: voice}, "Crew ride", 2*time.Hour, 3600, 190)
	putRide(t, ctx, st, user.ID, solo, "Short and hard", 3*time.Hour, MinLTHRRideSeconds-1, 188)
	putRide(t, ctx, st, user.ID, solo, "Last spring", 91*24*time.Hour, 3600, 186)
	putRide(t, ctx, st, user.ID, solo, "No strap", 4*time.Hour, 3600, 0)

	got, err := st.Queries.BestLast20mHRIn90Days(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 164 {
		t.Fatalf("best last-20 HR = %d, want 164 — the one solo 30-minute ride inside the window", got)
	}
}

// A rider with no qualifying ride gets 0, not an error and not somebody
// else's number.
func TestBestLast20mHRIn90DaysIsZeroWithoutAQualifyingRide(t *testing.T) {
	ctx, st, user := lthrFixture(t)
	got, err := st.Queries.BestLast20mHRIn90Days(ctx, user.ID)
	if err != nil || got != 0 {
		t.Fatalf("no rides: %d (%v), want 0", got, err)
	}
}

// The backfill fills EVERY row it reads, 0 included. A ride with no heart
// rate left null would be re-listed on every boot, for the life of the row:
// the loop would never report "done" and would read the same blobs forever.
//
// This runs the real sweep, which is global, against a database AGENTS.md is
// explicit is per-checkout rather than per-run. Tolerable because the sweep
// only ever writes a column no other test reads, and because every assertion
// below is by this test's own ride ids — never by the sweep having finished.
func TestBackfillLast20mHRLeavesNoRowInTheQueue(t *testing.T) {
	ctx, st, user := lthrFixture(t)

	hard := make([]protocol.RiderMetrics, 1800)
	for i := range hard {
		hard[i] = protocol.RiderMetrics{Watts: 230, HR: 150}
	}
	for i := 1200; i < 1800; i++ {
		hard[i].HR = 168
	}
	// The last 20 minutes are 600 s at 150 and 600 s at 168 → 159.
	row, err := BuildRideRow(user.ID, "Backfilled", `{"name":"W","steps":[]}`,
		time.Now().Add(-time.Hour), 250, hard)
	if err != nil {
		t.Fatal(err)
	}
	blob := row.Samples

	withHR := putRide(t, ctx, st, user.ID, place{}, "With HR", time.Hour, 1800, 0)
	noHR := putRide(t, ctx, st, user.ID, place{}, "No HR", 2*time.Hour, 1800, 0)
	junk := putRide(t, ctx, st, user.ID, place{}, "Junk", 3*time.Hour, 1800, 0)
	// Put all three back in the queue, and give one of them a real blob.
	if _, err := st.Pool.Exec(ctx,
		"update rides set last20m_hr = null, samples = $2 where id = $1", withHR, blob); err != nil {
		t.Fatal(err)
	}
	for _, id := range []pgtype.UUID{noHR, junk} {
		if _, err := st.Pool.Exec(ctx, "update rides set last20m_hr = null where id = $1", id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.Pool.Exec(ctx,
		"update rides set samples = $2 where id = $1", junk, []byte("not a sample blob")); err != nil {
		t.Fatal(err)
	}

	BackfillLast20mHR(ctx, st, slog.New(slog.DiscardHandler))

	read := func(id pgtype.UUID) *int16 {
		t.Helper()
		var v *int16
		if err := st.Pool.QueryRow(ctx, "select last20m_hr from rides where id = $1", id).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	for name, id := range map[string]pgtype.UUID{"with HR": withHR, "no HR": noHR, "unreadable": junk} {
		if read(id) == nil {
			t.Fatalf("%s is still null — the backfill will list it again on every boot", name)
		}
	}
	if got := read(withHR); *got != 159 {
		t.Fatalf("with HR: %d, want 159 — the average of the LAST 20 minutes", *got)
	}
	if got := read(noHR); *got != 0 {
		t.Fatalf("no HR: %d, want 0", *got)
	}
	if got := read(junk); *got != 0 {
		t.Fatalf("unreadable blob: %d, want 0 — there is no heart rate to recover", *got)
	}
}

// BuildRideRow computes it at save, so a ride recorded from today needs no
// backfill at all.
func TestBuildRideRowCarriesTheLast20mHR(t *testing.T) {
	samples := make([]protocol.RiderMetrics, 2400)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 200, HR: 140}
	}
	for i := 1200; i < 2400; i++ {
		samples[i].HR = 170
	}
	row, err := BuildRideRow(pgtype.UUID{}, "Test", `{"name":"W","steps":[]}`,
		time.Now(), 250, samples)
	if err != nil {
		t.Fatal(err)
	}
	if row.Last20mHr == nil || *row.Last20mHr != 170 {
		t.Fatalf("last20m_hr on the saved row: %v, want 170", row.Last20mHr)
	}
}
