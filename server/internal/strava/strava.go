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
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type Service struct {
	store        *store.Store
	log          *slog.Logger
	clientID     string
	clientSecret string
	// Overridable for tests; production values in New.
	apiBase   string
	tokenURL  string
	httpc     *http.Client
	now       func() time.Time
	pollEvery time.Duration
}

// New returns nil when the Strava app is not configured — the saver treats a
// nil uploader as "feature absent", the same capability gating as everywhere.
func New(st *store.Store, log *slog.Logger) *Service {
	id := os.Getenv("WATTROOM_OAUTH_STRAVA_ID")
	secret := os.Getenv("WATTROOM_OAUTH_STRAVA_SECRET")
	if id == "" || secret == "" {
		return nil
	}
	return &Service{ //nolint:gosec // the values come from env, nothing is hardcoded
		store: st, log: log, clientID: id, clientSecret: secret,
		apiBase:  "https://www.strava.com/api/v3",
		tokenURL: "https://www.strava.com/oauth/token", //nolint:gosec // a public endpoint URL, not a credential
		httpc:    &http.Client{Timeout: 30 * time.Second},
		now:      time.Now, pollEvery: 2 * time.Second,
	}
}

// RideSaved uploads in the background: the save transaction is long done, a
// Strava outage must cost nothing but a log line. The goroutine exits when
// the upload settles or the 90 s budget runs out.
func (s *Service) RideSaved(rideID pgtype.UUID) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		if err := s.upload(ctx, rideID); err != nil {
			s.log.Warn("strava upload failed", "err", err, "ride", store.UUIDString(rideID))
		}
	}()
}

func (s *Service) upload(ctx context.Context, rideID pgtype.UUID) error {
	ride, err := s.store.Queries.GetRideForUpload(ctx, rideID)
	if err != nil {
		return fmt.Errorf("load ride: %w", err)
	}
	if !ride.StravaUpload {
		return nil // the rider said no — not an error, not a log
	}
	ident, err := s.store.Queries.GetUserIdentity(ctx, db.GetUserIdentityParams{
		UserID: ride.UserID, Provider: "strava",
	})
	if err != nil {
		return nil // no Strava on this account — silently not a feature
	}
	token, err := s.freshToken(ctx, ident)
	if err != nil {
		return fmt.Errorf("token: %w", err)
	}

	fit, err := s.encode(ride)
	if err != nil {
		return fmt.Errorf("encode: %w", err)
	}

	uploadID, err := s.post(ctx, token, ride, fit)
	if err != nil {
		return err
	}
	return s.await(ctx, token, uploadID)
}

// freshToken refreshes when the stored access token is at or past expiry.
func (s *Service) freshToken(ctx context.Context, ident db.Identity) (string, error) {
	valid := ident.TokenExpiresAt.Valid &&
		ident.TokenExpiresAt.Time.After(s.now().Add(60*time.Second))
	if valid && ident.AccessToken != nil && *ident.AccessToken != "" {
		return *ident.AccessToken, nil
	}
	if ident.RefreshToken == nil || *ident.RefreshToken == "" {
		return "", fmt.Errorf("no refresh token stored")
	}
	form := url.Values{
		"client_id":     {s.clientID},
		"client_secret": {s.clientSecret},
		"grant_type":    {"refresh_token"},
		"refresh_token": {*ident.RefreshToken},
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
	err = s.store.Queries.UpdateIdentityTokens(ctx, db.UpdateIdentityTokensParams{
		Provider: "strava", ProviderUserID: ident.ProviderUserID,
		AccessToken: &tok.AccessToken, RefreshToken: &tok.RefreshToken,
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
func (s *Service) await(ctx context.Context, token string, uploadID int64) error {
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("upload %d still processing at deadline", uploadID)
		case <-time.After(s.pollEvery):
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			fmt.Sprintf("%s/uploads/%d", s.apiBase, uploadID), nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := s.httpc.Do(req)
		if err != nil {
			return err
		}
		var status struct {
			ActivityID *int64 `json:"activity_id"`
			Error      string `json:"error"`
		}
		decodeErr := json.NewDecoder(res.Body).Decode(&status)
		_ = res.Body.Close()
		if decodeErr != nil {
			return decodeErr
		}
		if status.Error != "" {
			return fmt.Errorf("processing failed: %s", status.Error)
		}
		if status.ActivityID != nil {
			s.log.Info("strava upload complete", "activity", *status.ActivityID)
			return nil
		}
	}
}
