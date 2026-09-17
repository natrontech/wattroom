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
