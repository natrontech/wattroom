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

	"github.com/natrontech/wattroom/server/internal/protocol"
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

// seedCode is the seeded crew's join code, and the mark of a seeded database.
const seedCode = "VELVET"

func run(ctx context.Context, dsn string) error {
	st, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer st.Close()

	// Idempotency the lazy way: one crew with a fixed code marks a seeded DB.
	code := seedCode
	if _, err := st.Queries.GetCrewByCode(ctx, &code); err == nil {
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

	// A crew with the Lounge a new crew opens with — a text channel and a
	// voice channel (ADR-0058) — and Sven in it. No room: #2558.
	crew, err := st.Queries.CreateCrew(ctx, db.CreateCrewParams{
		Name: "Velvet Hammer", OwnerID: jan.ID, Code: &code,
	})
	if err != nil {
		return fmt.Errorf("crew: %w", err)
	}
	for _, kind := range []string{"text", "voice"} {
		if _, err := st.Queries.CreateChannel(ctx, db.CreateChannelParams{
			CrewID: crew.ID, Kind: kind, Name: "Lounge", MaxChannels: protocol.MaxCrewTextChannels,
		}); err != nil {
			return fmt.Errorf("%s channel: %w", kind, err)
		}
	}
	if err := st.Queries.SetCrewRole(ctx, db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: sven.ID, Role: "member",
	}); err != nil {
		return fmt.Errorf("membership: %w", err)
	}

	// No library rows: the curated library ships in the web bundle
	// (web/src/lib/workout/library.ts) and every workouts query filters on an
	// owner, so an owner-less row was unreachable (#1713).
	return nil
}
