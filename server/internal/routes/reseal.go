package routes

import (
	"context"
	"errors"
	"fmt"

	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Reseal moves every route sealed under `prev` to `next` (#3024, ADR-0063):
// the key rotation a route needs, where a Strava token is simply reconnected
// (ADR-0035). One row at a time, each written only if it still carries the
// version it was read under, so running it twice — or beside a running
// server — is safe. Returns how many routes moved.
//
// A row that `prev` cannot open is left as it was and stops the run with an
// error: it was sealed under some third key, and guessing is not a re-seal.
func Reseal(ctx context.Context, q *db.Queries, prev, next *secrets.Cipher) (int, error) {
	if !prev.Enabled() || !next.Enabled() {
		return 0, errors.New("routes: re-sealing needs both the previous key and the new one")
	}
	from, to := prev.Version(), next.Version()
	if from == to {
		return 0, nil
	}
	moved := 0
	for {
		rows, err := q.ListRoutesSealedUnder(ctx, db.ListRoutesSealedUnderParams{KeyVersion: &from, Limit: 100})
		if err != nil {
			return moved, err
		}
		if len(rows) == 0 {
			return moved, nil
		}
		for _, row := range rows {
			shape, err := prev.Open(row.GeomSealed)
			if err != nil {
				return moved, fmt.Errorf("routes: a route under version %d would not open: %w", from, err)
			}
			sealed, err := next.Seal(shape)
			if err != nil {
				return moved, err
			}
			n, err := q.ResealRoute(ctx, db.ResealRouteParams{
				ID: row.ID, GeomSealed: sealed, NewVersion: &to, OldVersion: &from,
			})
			if err != nil {
				return moved, err
			}
			moved += int(n)
		}
	}
}
