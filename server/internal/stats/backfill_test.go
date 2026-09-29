package stats

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// A ride whose blob will not decode was stored with norm_watts = 0, which
// takes the row out of the backfill queue and puts it beyond every reader
// written for exactly this case (#2253): the fallbacks are `coalesce(
// norm_watts, avg_watts)` and `normWatts != nil`, and a stored 0 walks past
// both. The ride then reads 0 W NormPower on its own page and adds 0 to that
// day's Load, for good — indistinguishable from a ride with no power at all.
func TestAnUnreadableBlobStoresTheAverageNotZero(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: "backfill-test", FtpWatts: 250, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID) })

	// Saved before ADR-0016 (norm_watts null), with a blob nothing can read.
	id, err := st.Queries.CreateRide(ctx, db.CreateRideParams{
		UserID: user.ID, WorkoutName: "Unreadable",
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		Seconds:   600, AvgWatts: 187, Kj: 112, Execution: 0.9, FtpWatts: 250,
		Samples: []byte("not a sample blob"), Curve: []byte(`{}`), Xp: 10,
	})
	if err != nil {
		t.Fatal(err)
	}

	BackfillNormWatts(ctx, st, slog.New(slog.DiscardHandler))

	var norm *int16
	if err := st.Pool.QueryRow(ctx, "select norm_watts from rides where id = $1", id).Scan(&norm); err != nil {
		t.Fatal(err)
	}
	if norm == nil {
		t.Fatal("the row is still in the backfill queue — an unreadable blob must not be retried forever")
	}
	if *norm == 0 {
		t.Fatal("an unreadable blob stored 0, which every reader's fallback walks straight past")
	}
	if *norm != 187 {
		t.Errorf("norm_watts = %d, want the ride's own 187 W average — what the readers' coalesce would have chosen", *norm)
	}
}

// The 3- and 12-minute bests reach the rides already inside the 90-day curve
// (#3261), once: a second pass changes nothing, the four windows the ride
// already had stay as they were, and a ride older than the curve is left out.
func TestCriticalPowerBackfillIsIdempotent(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	user, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: "cp-backfill", FtpWatts: 250, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID) })

	// Fifteen minutes at 200 W opening with three at 400: 3 min 400, 12 min
	// (180×400 + 540×200) / 720 = 250.
	samples := flat(200, 900)
	for i := range 180 {
		samples[i].Watts = 400
	}
	legacy := []byte(`{"best5s": 400, "best1m": 400, "best5m": 320, "best20m": 0}`)
	save := func(ago time.Duration) pgtype.UUID {
		t.Helper()
		row, err := BuildRideRow(user.ID, "Openers", `{"name":"Openers","steps":[{"type":"steady","seconds":900,"target":0.8}]}`,
			time.Now().Add(-ago), 250, samples)
		if err != nil {
			t.Fatal(err)
		}
		row.Curve = legacy // saved before the pair was kept
		id, err := st.Queries.CreateRide(ctx, row)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	recent, old := save(24*time.Hour), save(120*24*time.Hour)
	curveOf := func(id pgtype.UUID) map[string]int {
		t.Helper()
		var curve map[string]int
		if err := st.Pool.QueryRow(ctx, "select curve from rides where id = $1", id).Scan(&curve); err != nil {
			t.Fatal(err)
		}
		return curve
	}

	BackfillCriticalPower(ctx, st, slog.New(slog.DiscardHandler))
	first := curveOf(recent)
	want := map[string]int{"best5s": 400, "best1m": 400, "best3m": 400, "best5m": 320, "best12m": 250, "best20m": 0}
	for key, value := range want {
		if first[key] != value {
			t.Errorf("after the backfill, %s = %d, want %d: %v", key, first[key], value, first)
		}
	}
	if _, touched := curveOf(old)["best3m"]; touched {
		t.Errorf("a ride older than the 90-day curve was backfilled: %v", curveOf(old))
	}

	// The second pass reads nothing and writes nothing: a pair already there
	// is left as it is, even one this pass would have computed differently.
	if _, err := st.Pool.Exec(ctx, `update rides set curve = jsonb_set(curve, '{best3m}', '1') where id = $1`, recent); err != nil {
		t.Fatal(err)
	}
	BackfillCriticalPower(ctx, st, slog.New(slog.DiscardHandler))
	if got := curveOf(recent)["best3m"]; got != 1 {
		t.Fatalf("the second pass rewrote a curve that already had the pair: best3m = %d, want the 1 it was left at", got)
	}
}
