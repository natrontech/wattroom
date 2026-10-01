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

// A session pays each ride in its own transaction (#3152): × 1.2 in a group
// session, the rider's own rate alone, and an amendment pays only what the
// ride grew by.
func TestASessionPaysBatzenInItsOwnTransaction(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	rider := func(name string) (db.User, protocol.Rider) {
		t.Helper()
		u, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: name, FtpWatts: 250, WeightKg: 75})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
		return u, protocol.Rider{ID: store.UUIDString(u.ID), Name: name, FtpWatts: 250, WeightKg: 75}
	}
	atFtp := func(seconds int) []protocol.RiderMetrics {
		out := make([]protocol.RiderMetrics, seconds)
		for i := range out {
			out[i] = protocol.RiderMetrics{Watts: 250, Cadence: 90, Seq: i + 1}
		}
		return out
	}
	riding := func(user pgtype.UUID) int64 {
		t.Helper()
		var n int64
		if err := st.Pool.QueryRow(ctx,
			"select coalesce(sum(amount), 0) from wallet_events where user_id = $1 and source in ('ride', 'ride_grew')",
			user).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	alice, aliceRider := rider("wallet-alice")
	bob, bobRider := rider("wallet-bob")
	carol, carolRider := rider("wallet-carol")
	voice := testx.Voice(t, st, testx.Crew(t, st, "Wallet", alice.ID), "Wallet", false)
	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	workoutJSON := `{"name":"W","steps":[{"type":"steady","seconds":1200,"target":1}]}`

	// Alice rides in a bought finish: the session makes it hers to keep (#3154).
	if _, err := st.Pool.Exec(ctx, `
		with owned as (insert into wardrobe (user_id, item_id, source) values ($1, 'finish.metallic', 'bought'))
		insert into outfits (user_id, loadout) values ($1, '{"finish":"finish.metallic"}')`, alice.ID); err != nil {
		t.Fatal(err)
	}

	// Two riders, twenty minutes each: a group session, 20 × 1.2.
	group := time.Now().Add(-3 * time.Hour).Truncate(time.Second)
	if err := saver.save(ctx, voice, "", "W", workoutJSON, group, []hub.RiderRecord{
		{Rider: aliceRider, Samples: atFtp(1200)}, {Rider: bobRider, Samples: atFtp(1200)},
	}); err != nil {
		t.Fatal(err)
	}
	if a, b := riding(alice.ID), riding(bob.ID); a != 24 || b != 24 {
		t.Fatalf("a group session paid %d and %d, want 24 each", a, b)
	}
	// Alice's tail arrives: its growth is a group session's too, as the save
	// decided (#3517). This save had no session id, and the amendment judged
	// it again and read it as solo.
	saver.AmendRide(ctx, voice, "", "W", workoutJSON, group, hub.RiderRecord{Rider: aliceRider, Samples: atFtp(2400)})
	if got := riding(alice.ID); got != 48 {
		t.Fatalf("alice's amended group ride paid %d in all, want 48: forty minutes × 1.2", got)
	}
	var worn bool
	if err := st.Pool.QueryRow(ctx, "select first_worn_at is not null from wardrobe where user_id = $1", alice.ID).Scan(&worn); err != nil || !worn {
		t.Fatalf("alice's finish after the session: worn %v (%v), want worn", worn, err)
	}

	// Carol alone for ten minutes, then her tail arrives: 10, then 10 more.
	alone := time.Now().Add(-time.Hour).Truncate(time.Second)
	if err := saver.save(ctx, voice, "", "W", workoutJSON, alone, []hub.RiderRecord{
		{Rider: carolRider, Samples: atFtp(600)},
	}); err != nil {
		t.Fatal(err)
	}
	if got := riding(carol.ID); got != 10 {
		t.Fatalf("a lone rider's ten minutes paid %d, want 10", got)
	}
	saver.AmendRide(ctx, voice, "", "W", workoutJSON, alone, hub.RiderRecord{Rider: carolRider, Samples: atFtp(1200)})
	saver.AmendRide(ctx, voice, "", "W", workoutJSON, alone, hub.RiderRecord{Rider: carolRider, Samples: atFtp(1200)}) // a replay
	if got := riding(carol.ID); got != 20 {
		t.Fatalf("the amended ride paid %d in all, want 20 — the growth once, not the whole ride again", got)
	}
}
