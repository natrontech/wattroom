package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// WithUserLocked runs fn in a transaction holding the rider's `users` row
// (`LockUser`). That lock is what makes a count-then-write pair hold under
// READ COMMITTED: without it every concurrent request reads the same count
// and every one proceeds, because each statement's subquery reads its own
// snapshot and writes to different rows never block each other.
//
// #824 established this for credential removal — "a rider can never reach
// zero credentials". #2258 put the passkey and token ceilings behind the same
// lock, where the count and the insert had been two statements with a whole
// WebAuthn ceremony between them.
//
// fn's error rolls the transaction back and is returned unwrapped, so a
// caller can carry its own sentinel out through it.
func (s *Store) WithUserLocked(ctx context.Context, userID pgtype.UUID, fn func(*db.Queries) error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.Queries.WithTx(tx)
	if err := q.LockUser(ctx, userID); err != nil {
		return err
	}
	if err := fn(q); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
