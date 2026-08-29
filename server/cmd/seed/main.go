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

	// Idempotency the lazy way: one room with a fixed code marks a seeded DB.
	if _, err := st.Queries.GetRoomByCode(ctx, "VELVET"); err == nil {
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
		Code: "VELVET", Slug: "velvet-hammer", Name: "Velvet Hammer", OwnerID: jan.ID,
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

	for name, def := range libraryWorkouts {
		_, err := st.Queries.CreateWorkout(ctx, db.CreateWorkoutParams{
			Name: name, Author: "wattroom", Definition: []byte(def),
		})
		if err != nil {
			return fmt.Errorf("workout %q: %w", name, err)
		}
	}
	return nil
}

// Two representative docs/SPEC.md workout definitions.
var libraryWorkouts = map[string]string{
	"Openers": `{"name":"Openers","author":"wattroom","steps":[
		{"type":"warmup","seconds":30,"from":0.4,"to":0.6},
		{"type":"steady","seconds":60,"target":0.9},
		{"type":"cooldown","seconds":30,"from":0.6,"to":0.4}]}`,
	"Sweet Spot 3x12": `{"name":"Sweet Spot 3x12","author":"wattroom","steps":[
		{"type":"warmup","seconds":600,"from":0.4,"to":0.7},
		{"type":"repeat","times":3,"steps":[
			{"type":"steady","seconds":720,"target":0.9},
			{"type":"steady","seconds":300,"target":0.5}]},
		{"type":"cooldown","seconds":600,"from":0.6,"to":0.4}]}`,
}
