package stats

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/wallet"
	"github.com/natrontech/wattroom/server/internal/wardrobe"
)

// mintSession pays each ride a session saved into its rider's wallet (#3152),
// inside the save's own transaction and under each rider's row lock, so the
// day's cap holds against a solo upload saving at the same moment. A group
// session — `rides` saved, `longest` seconds of timeline — pays × 1.2.
// ponytail: riders are locked in the order they rode; a rider is in one
// session at a time, so no two saves lock the same pair in opposite orders.
func mintSession(ctx context.Context, q *db.Queries, kept []savedRide, rides, longest int) error {
	group := GroupSession(rides, longest)
	// Kept on the rides, so an amendment pays what the save decided (#3517).
	ids := make([]pgtype.UUID, len(kept))
	for i, ride := range kept {
		ids[i] = ride.rideID
	}
	if err := q.MarkGroupSession(ctx, db.MarkGroupSessionParams{GroupSession: group, Ids: ids}); err != nil {
		return fmt.Errorf("stats: wallet group: %w", err)
	}
	for _, ride := range kept {
		if err := q.LockUser(ctx, ride.userID); err != nil {
			return fmt.Errorf("stats: wallet lock: %w", err)
		}
		if err := wallet.MintRide(ctx, q, ride.userID, ride.rideID, wallet.Batzen(ride.watts, ride.ftp, group)); err != nil {
			return fmt.Errorf("stats: wallet: %w", err)
		}
		// Whatever each rider wore is theirs to keep now, past the undo (#3154).
		if err := wardrobe.MarkWorn(ctx, q, ride.userID); err != nil {
			return fmt.Errorf("stats: outfit worn: %w", err)
		}
	}
	return nil
}

// mintGrowth pays what an amended ride earns beyond its first save, under
// the rider's row lock in the amendment's own transaction. Whether it was a
// group session is the save's own answer, kept on the ride (#3517): judged
// again here, a ride saved without a session id always read as solo.
func mintGrowth(ctx context.Context, q *db.Queries, user, ride pgtype.UUID, seconds int32, watts []int, ftp int) error {
	if err := q.LockUser(ctx, user); err != nil {
		return fmt.Errorf("stats: wallet lock: %w", err)
	}
	group, err := q.RideGroupSession(ctx, ride)
	if err != nil {
		return fmt.Errorf("stats: wallet session: %w", err)
	}
	// ponytail: null is a ride saved before the column, paid as solo. Only
	// the hub amends a ride, and its live state does not outlive the restart
	// that brought the column in.
	earned := wallet.Batzen(watts, ftp, group != nil && *group)
	if err := wallet.MintGrowth(ctx, q, user, ride, seconds, earned); err != nil {
		return fmt.Errorf("stats: wallet: %w", err)
	}
	return nil
}
