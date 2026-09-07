// Package strava is the auto-upload worker (#34): a finished ride, encoded
// as the .fit the export already produces, posted to the rider's OWN Strava.
// Upload-only is locked (WATTROOM.md) — nothing is ever pulled back or shown
// to anyone else. Single-athlete mode until the Standard Tier request.
package strava

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/fitexport"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type Service struct {
	store *store.Store
	log   *slog.Logger
	// Opens the sealed refresh token (#697). Nil on a server with no key, and
	// the plaintext column is then the only place it ever was.
	keys         *secrets.Cipher
	clientID     string
	clientSecret string
	// Overridable for tests; production values in New.
	apiBase   string
	tokenURL  string
	deauthURL string
	httpc     *http.Client
	now       func() time.Time
	pollEvery time.Duration
}

// New returns nil when the Strava app is not configured — the saver treats a
// nil uploader as "feature absent", the same capability gating as everywhere.
func New(st *store.Store, log *slog.Logger, keys *secrets.Cipher) *Service {
	id := os.Getenv("WATTROOM_OAUTH_STRAVA_ID")
	secret := os.Getenv("WATTROOM_OAUTH_STRAVA_SECRET")
	if id == "" || secret == "" {
		return nil
	}
	return &Service{ //nolint:gosec // the values come from env, nothing is hardcoded
		store: st, log: log, clientID: id, clientSecret: secret,
		apiBase:   "https://www.strava.com/api/v3",
		tokenURL:  "https://www.strava.com/oauth/token",       //nolint:gosec // a public endpoint URL, not a credential
		deauthURL: "https://www.strava.com/oauth/deauthorize", //nolint:gosec // likewise
		httpc:     &http.Client{Timeout: 30 * time.Second},
		now:       time.Now, pollEvery: 2 * time.Second,
	}
}

// Destination is what a ride_exports row is keyed by. One provider today; the
// column exists so the second one is a row and not a schema change (#799).
const Destination = "strava"

// How the delivery record is kept. Operational guards, not product numbers.
const (
	// Attempts before a delivery is declared failed and stops being swept.
	maxAttempts = 5
	// How quiet a pending row must be before the sweep picks it up again. The
	// backoff is attempts × this — a Strava outage is retried over hours, not
	// hammered for a minute.
	retryBase = 5 * time.Minute
	// Deliveries started per sweep. A backlog drains over several sweeps
	// rather than opening a hundred uploads at once.
	sweepBatch = 20
	// How often the sweep runs.
	sweepEvery = time.Minute
	// One delivery's own budget, upload and processing poll together.
	attemptBudget = 90 * time.Second
)

// RideSaved uploads in the background: the save transaction is long done, a
// Strava outage must cost nothing but a log line. The goroutine exits when
// the upload settles or the budget runs out — and either way the outcome is
// on the ride's delivery record, so a restart or an outage is picked up by
// the sweep instead of being abandoned (#799).
func (s *Service) RideSaved(rideID pgtype.UUID) {
	safego.Go(s.log, "strava upload", func() {
		ctx, cancel := context.WithTimeout(context.Background(), attemptBudget)
		defer cancel()
		s.deliver(ctx, rideID)
	})
}

// Sweep retries deliveries that are still owed one, forever, on its own
// goroutine. Started once from main; it exits when ctx is done.
func (s *Service) Sweep(ctx context.Context) {
	safego.Supervise(s.log, s.now, "strava delivery sweep", ctx.Done(), func() {
		ticker := time.NewTicker(sweepEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			s.sweepOnce(ctx)
		}
	})
}

func (s *Service) sweepOnce(ctx context.Context) {
	due, err := s.store.Queries.ListRideExportsDue(ctx, db.ListRideExportsDueParams{
		Before:  pgtype.Timestamptz{Time: s.now().Add(-retryBase), Valid: true},
		MaxRows: sweepBatch,
	})
	if err != nil {
		s.log.Warn("strava sweep query failed", "err", err)
		return
	}
	for _, row := range due {
		// attempts × retryBase: the more a delivery has failed, the longer it
		// waits. The query has already applied the first step of that; this is
		// the widening, off the same injectable clock.
		if row.UpdatedAt.Time.After(s.now().Add(-time.Duration(row.Attempts) * retryBase)) {
			continue
		}
		attemptCtx, cancel := context.WithTimeout(ctx, attemptBudget)
		s.deliver(attemptCtx, row.RideID)
		cancel()
		if ctx.Err() != nil {
			return
		}
	}
}

// deliver runs one attempt and records what happened to it.
func (s *Service) deliver(ctx context.Context, rideID pgtype.UUID) {
	activityID, err := s.upload(ctx, rideID)
	switch {
	case err != nil:
		s.log.Warn("strava upload failed", "err", err, "ride", store.UUIDString(rideID))
		message := err.Error()
		if failErr := s.store.Queries.FailRideExport(ctx, db.FailRideExportParams{
			RideID: rideID, Destination: Destination,
			LastError: &message, MaxAttempts: maxAttempts,
		}); failErr != nil {
			s.log.Warn("strava delivery record not updated", "err", failErr)
		}
	case activityID != nil:
		if doneErr := s.store.Queries.FinishRideExport(ctx, db.FinishRideExportParams{
			RideID: rideID, Destination: Destination, RemoteID: activityID,
		}); doneErr != nil {
			s.log.Warn("strava delivery record not updated", "err", doneErr)
		}
	}
	// activityID nil with no error is "the rider does not want this ride
	// there" — no record, nothing to retry, nothing to show.
}

// upload runs one delivery attempt. A nil activity id with a nil error means
// the ride was never eligible: the rider turned auto-upload off, or has no
// Strava on the account at all. Neither is a failure and neither is retried.
func (s *Service) upload(ctx context.Context, rideID pgtype.UUID) (*int64, error) {
	ride, err := s.store.Queries.GetRideForUpload(ctx, rideID)
	if err != nil {
		return nil, fmt.Errorf("load ride: %w", err)
	}
	if !ride.StravaUpload {
		return nil, nil // the rider said no — not an error, not a log
	}
	ident, err := s.store.Queries.GetUserIdentity(ctx, db.GetUserIdentityParams{
		UserID: ride.UserID, Provider: "strava",
	})
	if err != nil {
		return nil, nil // no Strava on this account — silently not a feature
	}
	// The ride is eligible, so from here every outcome is worth remembering:
	// open the delivery record before the first remote call, or a crash
	// between here and the answer leaves nothing to sweep.
	if startErr := s.store.Queries.StartRideExport(ctx, db.StartRideExportParams{
		RideID: rideID, Destination: Destination,
	}); startErr != nil {
		s.log.Warn("strava delivery record not opened", "err", startErr)
	}
	token, err := s.freshToken(ctx, ident)
	if err != nil {
		return nil, fmt.Errorf("token: %w", err)
	}

	fit, err := s.encode(ride)
	if err != nil {
		return nil, fmt.Errorf("encode: %w", err)
	}

	uploadID, err := s.post(ctx, token, ride, fit)
	if err != nil {
		return nil, err
	}
	return s.await(ctx, token, uploadID)
}

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

func (s *Service) encode(ride db.GetRideForUploadRow) ([]byte, error) {
	metrics, err := stats.DecodeSamples(ride.Samples)
	if err != nil {
		return nil, err
	}
	samples := make([]fitexport.Sample, len(metrics))
	for i, m := range metrics {
		samples[i] = fitexport.Sample{
			Second:    i,
			Watts:     clampU16(m.Watts),
			Cadence:   clampU8(m.Cadence),
			HeartRate: clampU8(m.HR),
		}
	}
	return fitexport.Encode(fitexport.Ride{
		StartedAt: ride.StartedAt.Time, Samples: samples,
	})
}

func clampU16(v int) uint16 {
	if v < 0 {
		return 0
	}
	if v > 65535 {
		return 65535
	}
	return uint16(v)
}

func clampU8(v int) uint8 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return uint8(v)
}

// post sends the multipart upload; external_id is the ride's UUID so a
// re-delivery dedupes on Strava's side rather than duplicating an activity.
func (s *Service) post(ctx context.Context, token string, ride db.GetRideForUploadRow, fit []byte) (int64, error) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "wattroom.fit")
	if err != nil {
		return 0, err
	}
	if _, err := part.Write(fit); err != nil {
		return 0, err
	}
	fields := map[string]string{
		"data_type":   "fit",
		"name":        ride.WorkoutName,
		"external_id": "wattroom-" + store.UUIDString(ride.ID),
	}
	for k, v := range fields {
		if err := form.WriteField(k, v); err != nil {
			return 0, err
		}
	}
	if err := form.Close(); err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiBase+"/uploads", &body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := s.httpc.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusCreated && res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 200))
		return 0, fmt.Errorf("upload: status %d: %s", res.StatusCode, snippet)
	}
	var up struct {
		ID    int64  `json:"id"`
		Error string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&up); err != nil {
		return 0, err
	}
	if up.Error != "" {
		return 0, fmt.Errorf("upload rejected: %s", up.Error)
	}
	return up.ID, nil
}

// await polls the async processing until Strava settles it (#34's spec).
func (s *Service) await(ctx context.Context, token string, uploadID int64) (*int64, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("upload %d still processing at deadline", uploadID)
		case <-time.After(s.pollEvery):
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			fmt.Sprintf("%s/uploads/%d", s.apiBase, uploadID), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := s.httpc.Do(req)
		if err != nil {
			return nil, err
		}
		var status struct {
			ActivityID *int64 `json:"activity_id"`
			Error      string `json:"error"`
		}
		decodeErr := json.NewDecoder(res.Body).Decode(&status)
		_ = res.Body.Close()
		if decodeErr != nil {
			return nil, decodeErr
		}
		if status.Error != "" {
			return nil, fmt.Errorf("processing failed: %s", status.Error)
		}
		if status.ActivityID != nil {
			s.log.Info("strava upload complete", "activity", *status.ActivityID)
			return status.ActivityID, nil
		}
	}
}

// RevokeGrant hands the rider's authorization back to Strava when they
// disconnect it (#783). Dropping our row while Strava still lists WattRoom
// among their connected apps would tell them something untrue.
//
// The access token goes in the query string because that is where Strava's
// deauthorize endpoint documents it; a stale one is refreshed first, since a
// grant nobody has used for a while is exactly the one being disconnected.
func (s *Service) RevokeGrant(ctx context.Context, ident db.Identity) error {
	token, err := s.freshToken(ctx, ident)
	if err != nil {
		return fmt.Errorf("strava: no usable token to revoke: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		s.deauthURL+"?access_token="+url.QueryEscape(token), nil)
	if err != nil {
		return err
	}
	res, err := s.httpc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	// 401 means the grant is already gone — the rider revoked it at Strava,
	// which is the outcome this asked for.
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusUnauthorized {
		return fmt.Errorf("strava: deauthorize returned %d", res.StatusCode)
	}
	return nil
}
