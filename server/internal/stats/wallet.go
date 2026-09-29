package stats

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/wallet"
)

// mintSession pays each ride a session saved into its rider's wallet (#3152),
// inside the save's own transaction and under each rider's row lock, so the
// day's cap holds against a solo upload saving at the same moment. A group
// session — `rides` saved, `longest` seconds of timeline — pays × 1.2.
// ponytail: riders are locked in the order they rode; a rider is in one
// session at a time, so no two saves lock the same pair in opposite orders.
func mintSession(ctx context.Context, q *db.Queries, kept []savedRide, rides, longest int) error {
	group := GroupSession(rides, longest)
	for _, ride := range kept {
		if err := q.LockUser(ctx, ride.userID); err != nil {
			return fmt.Errorf("stats: wallet lock: %w", err)
		}
		if err := wallet.MintRide(ctx, q, ride.userID, ride.rideID, wallet.Batzen(ride.watts, ride.ftp, group)); err != nil {
			return fmt.Errorf("stats: wallet: %w", err)
		}
	}
	return nil
}

// mintGrowth pays what an amended ride earns beyond its first save, under
// the rider's row lock in the amendment's own transaction. Whether it was a
// group session is read off the rides its session saved.
func mintGrowth(ctx context.Context, q *db.Queries, user, ride pgtype.UUID, seconds int32, watts []int, ftp int) error {
	if err := q.LockUser(ctx, user); err != nil {
		return fmt.Errorf("stats: wallet lock: %w", err)
	}
	shape, err := q.SessionShapeOfRide(ctx, ride)
	if err != nil {
		return fmt.Errorf("stats: wallet session: %w", err)
	}
	earned := wallet.Batzen(watts, ftp, GroupSession(int(shape.Rides), int(shape.Longest)))
	if err := wallet.MintGrowth(ctx, q, user, ride, seconds, earned); err != nil {
		return fmt.Errorf("stats: wallet: %w", err)
	}
	return nil
}
