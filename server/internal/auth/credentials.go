package auth

// The account's credential set (#783, ADR-0029): the rule that binds providers
// and passkeys together, and the route that takes a provider back out.
//
// Both removal paths ask the same question of the same query. An invariant
// kept in two places is one that eventually disagrees with itself, and the
// disagreement here would lock a rider out of their own account.

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// GrantRevoker hands a third-party grant back before we drop our copy of it.
// Only Strava keeps tokens, so only Strava has one (server/internal/strava).
type GrantRevoker interface {
	RevokeGrant(ctx context.Context, ident db.Identity) error
}

// SetStravaRevoker wires the uploader in after construction, the same shape
// SetMailer uses. Absent, a disconnect still drops our row.
func (s *Service) SetStravaRevoker(r GrantRevoker) { s.stravaRevoker = r }

// Providers and passkeys count together: a rider whose only way in is one
// Strava grant must not be able to remove it, and neither must the one whose
// only way in is a single passkey.
const lastCredentialMessage = "This is the only way into your account. Add a passkey or connect another sign-in provider first."

// refuseIfLastCredential writes the refusal and reports whether it did. An
// early answer only — removeCredential is what holds the rule. It exists so a
// rider whose only way in is Strava is told no BEFORE their grant is revoked
// upstream, not after.
func (s *Service) refuseIfLastCredential(w http.ResponseWriter, r *http.Request, user db.User) bool {
	total, err := s.store.Queries.CountUserCredentials(r.Context(), user.ID)
	if err != nil {
		s.log.Error("credential count failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That could not be removed. Try again.")
		return true
	}
	if total <= 1 {
		httpx.WriteError(w, http.StatusConflict, "conflict", lastCredentialMessage)
		return true
	}
	return false
}

// removeCredential runs del with the rider's row locked, so two removals
// cannot both count two credentials and both proceed (#824): the second waits
// on the row, then counts one. last reports that the count refused it; rows
// is what del removed.
func (s *Service) removeCredential(ctx context.Context, userID pgtype.UUID, del func(q *db.Queries) (int64, error)) (rows int64, last bool, err error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return 0, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(ctx, userID); err != nil {
		return 0, false, err
	}
	total, err := q.CountUserCredentials(ctx, userID)
	if err != nil {
		return 0, false, err
	}
	if total <= 1 {
		return 0, true, nil
	}
	if rows, err = del(q); err != nil {
		return 0, false, err
	}
	return rows, false, tx.Commit(ctx)
}

// handleDisconnectProvider removes one identity from the account. Until this
// existed a rider who connected the wrong Strava account had no way out short
// of deleting the whole account.
func (s *Service) handleDisconnectProvider(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	provider := r.PathValue("provider")

	ident, err := s.store.Queries.GetUserIdentity(r.Context(), db.GetUserIdentityParams{
		UserID: user.ID, Provider: provider,
	})
	switch {
	case err == nil:
	case errors.Is(err, pgx.ErrNoRows):
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That provider is not connected to this account.")
		return
	default:
		s.log.Error("identity lookup failed", "provider", provider, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That provider could not be disconnected. Try again.")
		return
	}

	if s.refuseIfLastCredential(w, r, user) {
		return
	}

	// Hand the grant back before dropping our copy: a row deleted here while
	// Strava still lists the app tells the rider something untrue. A failure
	// is logged rather than fatal — they asked to disconnect, and refusing
	// because Strava is down leaves them connected to something they wanted
	// gone, still holding a token we can no longer refresh on their behalf.
	if provider == "strava" && s.stravaRevoker != nil {
		if err := s.stravaRevoker.RevokeGrant(r.Context(), ident); err != nil {
			s.log.Warn("strava grant not revoked upstream", "user", user.ID, "err", err)
		}
	}

	rows, last, err := s.removeCredential(r.Context(), user.ID, func(q *db.Queries) (int64, error) {
		return q.DeleteIdentity(r.Context(), db.DeleteIdentityParams{UserID: user.ID, Provider: provider})
	})
	switch {
	case err != nil:
		s.log.Error("identity delete failed", "provider", provider, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"That provider could not be disconnected. Try again.")
	case last:
		httpx.WriteError(w, http.StatusConflict, "conflict", lastCredentialMessage)
	case rows == 0:
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That provider is not connected to this account.")
	default:
		s.log.Info("provider disconnected", "user", user.ID, "provider", provider)
		s.alert(user, "A sign-in provider was disconnected",
			providerLabel(provider)+" can no longer sign in to your WattRoom account.")
		w.WriteHeader(http.StatusNoContent)
	}
}
