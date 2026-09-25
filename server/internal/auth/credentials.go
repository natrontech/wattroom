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
		httpx.Fail(w, s.log, "credential count failed", err, "That could not be removed. Try again.")
		return true
	}
	if total <= 1 {
		httpx.WriteError(w, http.StatusConflict, "conflict", lastCredentialMessage)
		return true
	}
	return false
}

// errLastCredential is the refusal, carried out of the locked transaction so
// the rollback releases the row the moment the answer is known rather than at
// a commit that had nothing to write.
var errLastCredential = errors.New("auth: that is the last credential")

// removeCredential runs del with the rider's row locked, so two removals
// cannot both count two credentials and both proceed (#824): the second waits
// on the row, then counts one. last reports that the count refused it; rows
// is what del removed.
func (s *Service) removeCredential(ctx context.Context, userID pgtype.UUID, del func(q *db.Queries) (int64, error)) (rows int64, last bool, err error) {
	err = s.store.WithUserLocked(ctx, userID, func(q *db.Queries) error {
		total, err := q.CountUserCredentials(ctx, userID)
		if err != nil {
			return err
		}
		if total <= 1 {
			return errLastCredential
		}
		rows, err = del(q)
		return err
	})
	if errors.Is(err, errLastCredential) {
		return 0, true, nil
	}
	if err != nil {
		return 0, false, err
	}
	return rows, false, nil
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
		httpx.Fail(w, s.log, "identity lookup failed", err, "That provider could not be disconnected. Try again.", "provider", provider)
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
		if provider == "strava" {
			return forgetStrava(r.Context(), q, user.ID)
		}
		return q.DeleteIdentity(r.Context(), db.DeleteIdentityParams{UserID: user.ID, Provider: provider})
	})
	switch {
	case err != nil:
		httpx.Fail(w, s.log, "identity delete failed", err, "That provider could not be disconnected. Try again.", "provider", provider)
	case last:
		httpx.WriteError(w, http.StatusConflict, "conflict", lastCredentialMessage)
	case rows == 0:
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That provider is not connected to this account.")
	default:
		s.log.Info("provider disconnected", "user", user.ID, "provider", provider)
		s.providerDisconnected(user, provider)
		s.endOtherSessions(r.Context(), user.ID, r)
		w.WriteHeader(http.StatusNoContent)
	}
}

// providerDisconnected is ADR-0030's alarm for an identity that left the
// account, whichever side took it away.
func (s *Service) providerDisconnected(user db.User, provider string) {
	s.alert(user, "A sign-in provider was disconnected",
		providerLabel(provider)+" can no longer sign in to your WattRoom account.")
}

// forgetStrava drops the Strava identity and, in the same transaction, the
// activity ids its grant issued (#1507): WATTROOM.md binds §7.4 — everything
// goes within 30 days of deauthorization — and nothing deleted them on any
// path but a full account purge. Exact rather than a 30-day sweep, which would
// need a column to hold the clock and a job to watch it.
//
// The delivery rows stay: they are our bookkeeping about rides we recorded,
// and the ride page reads them. The identity's provider is the destination
// because the identity and the upload target are the same word — a second
// remote would bring its own name for both.
func forgetStrava(ctx context.Context, q *db.Queries, userID pgtype.UUID) (int64, error) {
	if _, err := q.ForgetRemoteActivityIds(ctx, db.ForgetRemoteActivityIdsParams{
		UserID: userID, Destination: "strava",
	}); err != nil {
		return 0, err
	}
	return q.DeleteIdentity(ctx, db.DeleteIdentityParams{UserID: userID, Provider: "strava"})
}

// ForgetStravaGrant is the disconnect for a grant the rider took back on
// Strava's side (#2823) — at strava.com/settings/apps, the usual way, which
// never passes through handleDisconnectProvider and so kept the tokens and the
// activity ids for good. The strava package calls it once Strava has confirmed
// the grant is gone; there is nothing to revoke upstream.
//
// When Strava is the rider's only way in, the identity stays, emptied of its
// tokens: deleting it would lock them out of their own account, and signing in
// with Strava again is exactly how they re-grant (link and upsert refresh the
// tokens of an identity they find).
func (s *Service) ForgetStravaGrant(ctx context.Context, ident db.Identity) error {
	rows, last, err := s.removeCredential(ctx, ident.UserID, func(q *db.Queries) (int64, error) {
		return forgetStrava(ctx, q, ident.UserID)
	})
	if err != nil {
		return err
	}
	if last {
		return s.store.WithUserLocked(ctx, ident.UserID, func(q *db.Queries) error {
			if _, err := q.ForgetRemoteActivityIds(ctx, db.ForgetRemoteActivityIdsParams{
				UserID: ident.UserID, Destination: "strava",
			}); err != nil {
				return err
			}
			// Every token column NULL: the zero params are the grant forgotten.
			return q.UpdateIdentityTokens(ctx, db.UpdateIdentityTokensParams{
				Provider: "strava", ProviderUserID: ident.ProviderUserID,
			})
		})
	}
	if rows == 0 {
		return nil
	}
	s.log.Info("strava grant revoked on strava, identity removed", "user", ident.UserID)
	user, err := s.store.Queries.GetUser(ctx, ident.UserID)
	if err != nil {
		return err
	}
	s.providerDisconnected(user, "strava")
	return nil
}
