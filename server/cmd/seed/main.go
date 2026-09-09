// Seeds the compose dev environment (#15): two riders, one room, a couple of
// library workouts. Idempotent — safe to run repeatedly.
//
// ponytail: the full 26-workout library lives in web/src/lib/workout/library.ts
// and stays client-side for now; seeding two representative definitions here is
// enough to exercise the workouts table. Moving the library server-side is the
// workout-sync question, not the schema's.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	dsn := os.Getenv("WATTROOM_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom" //nolint:gosec // compose dev credentials, same literal as docker-compose.yml
	}
	if err := run(context.Background(), dsn); err != nil {
		log.Error("seed failed", "err", err)
		os.Exit(1)
	}
	log.Info("seeded", "db", dsn)
}

func run(ctx context.Context, dsn string) error {
	st, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer st.Close()

	// Idempotency the lazy way: one room with a fixed slug marks a seeded DB.
	if _, err := st.Queries.GetRoomBySlug(ctx, "velvet-hammer"); err == nil {
		return nil
	}

	jan, err := st.Queries.CreateUser(ctx, db.CreateUserParams{
		DisplayName: "Jan", FtpWatts: 280, WeightKg: 82,
	})
	if err != nil {
		return fmt.Errorf("user: %w", err)
	}
	sven, err := st.Queries.CreateUser(ctx, db.CreateUserParams{
		DisplayName: "Sven", FtpWatts: 250, WeightKg: 78,
	})
	if err != nil {
		return fmt.Errorf("user: %w", err)
	}

	room, err := st.Queries.CreateRoom(ctx, db.CreateRoomParams{
		Slug: "velvet-hammer", Name: "Velvet Hammer", OwnerID: jan.ID,
	})
	if err != nil {
		return fmt.Errorf("room: %w", err)
	}
	members := []struct {
		user pgtype.UUID
		role string
	}{{jan.ID, "owner"}, {sven.ID, "member"}}
	for _, m := range members {
		err := st.Queries.CreateMembership(ctx, db.CreateMembershipParams{
			RoomID: room.ID, UserID: m.user, Role: m.role,
		})
		if err != nil {
			return fmt.Errorf("membership: %w", err)
		}
	}

	// No library rows: the curated library ships in the web bundle
	// (web/src/lib/workout/library.ts) and every workouts query filters on an
	// owner, so an owner-less row was unreachable (#1713).
	return nil
}
