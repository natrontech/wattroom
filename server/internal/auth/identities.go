// How an identity becomes a user, or attaches to one: first sign-in creates
// the account (upsert), a signed-in rider adds a second provider (link).
package auth

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// upsert finds or creates the user behind an identity. First sign-in creates
// the account; every later one just refreshes Strava's stored grant.
//
// created tells the caller which of those happened, which is the whole of
// #784: a rider who meant to sign into an existing account and reached a new
// one should hear about it at the one moment undoing it is cheap.
func (s *Service) upsert(r *http.Request, p provider, ident identity, tok *oauth2.Token) (user db.User, created bool, err error) {
	ctx := r.Context()
	q := s.store.Queries

	existing, err := q.GetIdentity(ctx, db.GetIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID,
	})
	switch {
	case err == nil:
		if p.keepTokens {
			params, err := s.tokenParams(p, ident, tok)
			if err != nil {
				return db.User{}, false, err
			}
			if err := q.UpdateIdentityTokens(ctx, params); err != nil {
				return db.User{}, false, err
			}
		}
		found, err := q.GetUser(ctx, existing.UserID)
		return found, false, err
	case errors.Is(err, pgx.ErrNoRows):
		// fall through to create
	default:
		return db.User{}, false, err
	}

	name := ident.DisplayName
	if name == "" {
		name = "Rider"
	}
	var avatar *string
	if ident.AvatarURL != "" {
		avatar = &ident.AvatarURL
	}
	user, err = q.CreateUser(ctx, db.CreateUserParams{
		DisplayName: name, AvatarUrl: avatar, FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		return db.User{}, false, err
	}
	create := db.CreateIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID, UserID: user.ID,
	}
	if p.keepTokens {
		tp, err := s.tokenParams(p, ident, tok)
		if err != nil {
			return db.User{}, false, err
		}
		create.AccessToken, create.RefreshToken, create.RefreshTokenEnc, create.TokenExpiresAt =
			tp.AccessToken, tp.RefreshToken, tp.RefreshTokenEnc, tp.TokenExpiresAt
	}
	if err := q.CreateIdentity(ctx, create); err != nil {
		// Two callbacks for the same identity can race past the earlier lookup
		// (parallel e2e workers found this; a double-clicked OAuth redirect
		// does the same). The loser adopts the winner's user; its own orphan
		// user row is removed so the race leaves no residue.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			winner, lookupErr := q.GetIdentity(ctx, db.GetIdentityParams{
				Provider: p.id, ProviderUserID: ident.ProviderUserID,
			})
			if lookupErr != nil {
				return db.User{}, false, lookupErr
			}
			_ = q.DeleteUser(ctx, user.ID)
			// The loser adopts the winner's account, so nothing was created
			// here even though this branch ran CreateUser.
			adopted, err := q.GetUser(ctx, winner.UserID)
			return adopted, false, err
		}
		return db.User{}, false, err
	}
	return user, true, nil
}

// errIdentityTaken: the provider account is already somebody else's way in.
// Reassigning the row would hand this rider that account, so linking refuses
// and writes nothing (#719). Merging two accounts is a separate problem.
var errIdentityTaken = errors.New("identity belongs to another account")

// errProviderAlreadyLinked: this account already has an identity with this
// provider. One per provider per account is not tidiness — GetUserIdentity is
// a :one query, so a second Strava row would make the upload worker's choice
// of grant arbitrary (server/internal/strava/strava.go).
var errProviderAlreadyLinked = errors.New("provider already linked to this account")

// link attaches ident to userID. Unlike upsert it never creates a user and
// never touches the session — the rider stays signed in as who they were.
func (s *Service) link(r *http.Request, p provider, ident identity, tok *oauth2.Token, userID pgtype.UUID) error {
	ctx := r.Context()
	q := s.store.Queries

	existing, err := q.GetIdentity(ctx, db.GetIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID,
	})
	switch {
	case err == nil:
		if existing.UserID != userID {
			return errIdentityTaken
		}
		// Already linked here: nothing to add, but a fresh Strava grant is
		// worth keeping — this is how a rider re-authorizes after a revoke.
		if p.keepTokens {
			params, err := s.tokenParams(p, ident, tok)
			if err != nil {
				return err
			}
			return q.UpdateIdentityTokens(ctx, params)
		}
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		// fall through to create
	default:
		return err
	}

	// One identity per provider per account. The dev provider is exempt: it is
	// the local stand-in for several different people on one box (?as=), and
	// production never configures it.
	if p.id != "dev" {
		switch _, err := q.GetUserIdentity(ctx, db.GetUserIdentityParams{
			UserID: userID, Provider: p.id,
		}); {
		case err == nil:
			return errProviderAlreadyLinked
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return err
		}
	}

	create := db.CreateIdentityParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID, UserID: userID,
	}
	if p.keepTokens {
		tp, err := s.tokenParams(p, ident, tok)
		if err != nil {
			return err
		}
		create.AccessToken, create.RefreshToken, create.RefreshTokenEnc, create.TokenExpiresAt =
			tp.AccessToken, tp.RefreshToken, tp.RefreshTokenEnc, tp.TokenExpiresAt
	}
	if err := q.CreateIdentity(ctx, create); err != nil {
		// Someone claimed this identity between the lookup and the insert —
		// the same race upsert guards against. Whoever won decides the answer.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			winner, lookupErr := q.GetIdentity(ctx, db.GetIdentityParams{
				Provider: p.id, ProviderUserID: ident.ProviderUserID,
			})
			if lookupErr != nil {
				return lookupErr
			}
			if winner.UserID != userID {
				return errIdentityTaken
			}
			return nil
		}
		return err
	}
	return nil
}

// finishLink runs the link and sends the rider back to the profile, which
// reads ?link= and says what happened. The callback is a top-level browser
// navigation, so a JSON error body would land as raw text in the address bar —
// the banner is the error surface here (.claude/rules/errors.md).
func (s *Service) finishLink(w http.ResponseWriter, r *http.Request, p provider, ident identity, tok *oauth2.Token, to db.User) {
	outcome := "connected"
	switch err := s.link(r, p, ident, tok, to.ID); {
	case err == nil:
		s.alert(to, "A sign-in provider was connected",
			providerLabel(p.id)+" can now sign in to your WattRoom account.")
	case errors.Is(err, errIdentityTaken):
		s.log.Warn("link refused: identity already linked elsewhere", "provider", p.id)
		outcome = "taken"
	case errors.Is(err, errProviderAlreadyLinked):
		outcome = "duplicate"
	default:
		s.log.Error("link failed", "provider", p.id, "err", err)
		outcome = "failed"
	}
	http.Redirect(w, r, "/profile?link="+outcome+"&provider="+url.QueryEscape(p.id), http.StatusFound)
}

// tokenParams shapes a provider's tokens for storage. The refresh token is
// the one that is kept to be used again, so it is the one that gets sealed
// (#697); the access token expires in hours and is replaced from it.
func (s *Service) tokenParams(p provider, ident identity, tok *oauth2.Token) (db.UpdateIdentityTokensParams, error) {
	expiry := pgtype.Timestamptz{Time: tok.Expiry, Valid: !tok.Expiry.IsZero()}
	access := tok.AccessToken
	refresh, sealed, err := s.keys.Columns(tok.RefreshToken)
	if err != nil {
		return db.UpdateIdentityTokensParams{}, fmt.Errorf("seal refresh token: %w", err)
	}
	return db.UpdateIdentityTokensParams{
		Provider: p.id, ProviderUserID: ident.ProviderUserID,
		AccessToken: &access, RefreshToken: refresh, RefreshTokenEnc: sealed,
		TokenExpiresAt: expiry,
	}, nil
}
