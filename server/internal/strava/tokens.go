// The grant: a fresh access token off the stored refresh token, and taking
// the grant back when the rider disconnects.
package strava

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// refreshToken reads the stored refresh token from whichever column holds it
// (#697). Sealed wins: during the release that introduces the key, rows
// written since have only the sealed one and rows not yet touched have only
// the plaintext, and both have to keep working.
//
// A sealed value that will not open is NOT reported as "no token stored":
// that is a wrong or rotated key, and answering it with "reconnect your Strava
// account" would have every rider re-authorise over an operator's mistake.
func (s *Service) refreshToken(ident db.Identity) (string, error) {
	if len(ident.RefreshTokenEnc) > 0 {
		token, err := s.keys.Open(ident.RefreshTokenEnc)
		if err != nil {
			return "", fmt.Errorf("stored refresh token cannot be read — is %s the key it was sealed with? %w", secrets.KeyEnv, err)
		}
		return token, nil
	}
	if ident.RefreshToken == nil || *ident.RefreshToken == "" {
		return "", fmt.Errorf("no refresh token stored")
	}
	return *ident.RefreshToken, nil
}

// freshToken refreshes when the stored access token is at or past expiry.
func (s *Service) freshToken(ctx context.Context, ident db.Identity) (string, error) {
	valid := ident.TokenExpiresAt.Valid &&
		ident.TokenExpiresAt.Time.After(s.now().Add(60*time.Second))
	if valid && ident.AccessToken != nil && *ident.AccessToken != "" {
		return *ident.AccessToken, nil
	}
	refresh, err := s.refreshToken(ident)
	if err != nil {
		return "", err
	}
	form := url.Values{
		"client_id":     {s.clientID},
		"client_secret": {s.clientSecret},
		"grant_type":    {"refresh_token"},
		"refresh_token": {refresh},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.tokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := s.httpc.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("refresh: status %d", res.StatusCode)
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresAt    int64  `json:"expires_at"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil {
		return "", err
	}
	// Strava rotates the refresh token on every use, so this write is the one
	// that matters: seal the new one rather than replacing a sealed row with a
	// readable one (#697).
	stored, sealed, err := s.keys.Columns(tok.RefreshToken)
	if err != nil {
		return "", fmt.Errorf("seal refreshed token: %w", err)
	}
	err = s.store.Queries.UpdateIdentityTokens(ctx, db.UpdateIdentityTokensParams{
		Provider: "strava", ProviderUserID: ident.ProviderUserID,
		AccessToken: &tok.AccessToken, RefreshToken: stored, RefreshTokenEnc: sealed,
		TokenExpiresAt: pgtype.Timestamptz{Time: time.Unix(tok.ExpiresAt, 0), Valid: true},
	})
	if err != nil {
		return "", fmt.Errorf("persist refreshed token: %w", err)
	}
	return tok.AccessToken, nil
}

func (s *Service) RevokeGrant(ctx context.Context, ident db.Identity) error {
	token, err := s.freshToken(ctx, ident)
	if err != nil {
		return fmt.Errorf("strava: no usable token to revoke: %w", err)
	}
	form := url.Values{"token": {token}, "token_type_hint": {"access_token"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.revokeURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(s.clientID, s.clientSecret)
	res, err := s.httpc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	// No 401 tolerance any more. Under deauthorize a 401 meant "the grant is
	// already gone"; here it can only mean our client credentials are wrong,
	// and swallowing that would leave every rider's disconnect silently
	// failing. An unknown token is already a 200.
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("strava: revoke returned %d", res.StatusCode)
	}
	return nil
}
