package account

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleDelete is the purge. The confirmation lives client-side (a typed
// phrase); the server's job is to be certain who is asking and delete once.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.sessions.RequireUser(w, r, "Sign in first.")
	if !ok {
		return
	}
	// Read before the purge: after it the row is gone and there is nothing
	// left to hand back. The privacy page promises a full purge, and WattRoom
	// listed on the rider's Strava for ever was not one (#1825).
	strava, err := s.store.Queries.GetUserIdentity(r.Context(), db.GetUserIdentityParams{UserID: user.ID, Provider: "strava"})
	hasStrava := err == nil
	orphans, err := s.purge(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "account delete failed", err, "The deletion did not complete. Nothing was removed — try again.")
		return
	}
	// Log the fact, never the identity details: the account is gone.
	s.log.Info("account deleted", "user", store.UUIDString(user.ID))
	// After the commit, sparing nothing: a deleted rider's open tab went on
	// receiving the crew's watts and heart rate, and stood on the roster and
	// in the call under the old name until it closed.
	if s.live != nil {
		s.live.DropUser(store.UUIDString(user.ID), nil)
	}
	// The rider's uploaded audio goes with them (#1897): the cascade took the
	// rows, and the blobs only they pointed at come off disk after the commit.
	// A file another rider also holds stays — one blob per sha (#1095).
	if s.reaper != nil && len(orphans) > 0 {
		s.reaper.RemoveBlobs(orphans)
	}
	// And the flag reports they filed (#2906), which live in a file the
	// cascade cannot reach.
	if s.reports != nil {
		s.reports.RemoveReporter(store.UUIDString(user.ID))
	}
	// The grant goes back after the commit, detached and best-effort, the
	// disconnect's own posture: Strava being down must not fail a deletion
	// that already happened, and a failure is a warning, never a rider.
	if hasStrava && s.revoker != nil {
		revoker, ident := s.revoker, strava
		safego.Go(s.log, "strava revoke after delete", func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := revoker.RevokeGrant(ctx, ident); err != nil {
				s.log.Warn("strava grant not revoked upstream after delete", "err", err)
			}
		})
	}
	// The receipt goes to the address on the row read before the purge — after
	// it there is no row, and the mail would have no recipient. Fire-and-forget
	// inside notify, so a mail provider cannot fail a deletion that already
	// committed.
	if s.alerter != nil {
		s.alerter.AccountDeleted(user)
	}
	w.WriteHeader(http.StatusNoContent)
}

// purge is the delete, in one transaction: every crew the rider owns is
// handed on or removed (docs/SPEC.md's succession), then the row — and the
// schema's cascades take the rest as before. A room row they owned goes with
// the row, and leaves the crew's channel rows standing (#2561, #2558).
// Returns the content addresses of uploaded audio that only this rider's
// rows pointed at (#1897), read before the rows go, for the caller to take
// off disk once the commit holds.
func (s *Service) purge(ctx context.Context, user pgtype.UUID) ([]string, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.store.Queries.WithTx(tx)
	orphans, err := q.OrphanShasOfUser(ctx, user)
	if err != nil {
		return nil, fmt.Errorf("tracks: %w", err)
	}
	handedOn := func(context.Context) {}
	if s.crews != nil {
		if handedOn, err = s.crews.ReleaseCrews(ctx, q, user); err != nil {
			return nil, fmt.Errorf("crews: %w", err)
		}
	}
	if err := q.DeleteUser(ctx, user); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	handedOn(ctx)
	return orphans, nil
}
