// The upload itself: a saved ride encoded as FIT and handed to Strava, then
// polled until Strava says which activity it became.
package strava

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/fitexport"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

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
		return nil, fmt.Errorf("%w: %w", errToken, err)
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
		if res.StatusCode == http.StatusTooManyRequests {
			return 0, &rateLimited{after: retryAfterOf(res)}
		}
		return 0, &uploadRefused{status: res.StatusCode, snippet: string(snippet)}
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
		// The status, before the body (#1158). `post` has always done this;
		// here an error response decoded to a zero-value struct — no
		// activity id, no error — which the loop below read as "still
		// processing" and polled again. At a 2 s poll inside a 90 s budget
		// that answered one 429 with about forty-five more requests, times
		// twenty deliveries a sweep, aimed at an endpoint that had just said
		// stop.
		if res.StatusCode != http.StatusOK {
			snippet, _ := io.ReadAll(io.LimitReader(res.Body, 200))
			retryAfter := retryAfterOf(res)
			_ = res.Body.Close()
			if res.StatusCode == http.StatusTooManyRequests {
				return nil, &rateLimited{after: retryAfter}
			}
			return nil, &uploadRefused{status: res.StatusCode, snippet: string(snippet), uploadID: uploadID}
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

// errToken marks a failure to sign in to Strava on the rider's behalf — the
// class the rider can do something about (reconnect).
var errToken = errors.New("token")

// uploadRefused is Strava's own answer, kept whole for the log line and
// never for the rider (audit 2026-09-09).
type uploadRefused struct {
	status   int
	snippet  string
	uploadID int64
}

func (e *uploadRefused) Error() string {
	if e.uploadID != 0 {
		return fmt.Sprintf("upload %d status %d: %s", e.uploadID, e.status, e.snippet)
	}
	return fmt.Sprintf("upload: status %d: %s", e.status, e.snippet)
}

// exportFailure is what a rider is told (rides/detail.go serves last_error
// verbatim): one sentence per class, with the move that class has. The
// provider's response text, the key's env var and pgx stay in the log.
func exportFailure(err error) string {
	var refused *uploadRefused
	switch {
	case errors.Is(err, errToken):
		return "Strava no longer accepts WattRoom's sign-in for you — reconnect Strava in Settings › Your data, then retry."
	case errors.As(err, &refused) && (refused.status == http.StatusUnauthorized || refused.status == http.StatusForbidden):
		return "Strava no longer accepts WattRoom's sign-in for you — reconnect Strava in Settings › Your data, then retry."
	case errors.As(err, &refused) && refused.status < 500:
		return "Strava did not accept the file — retry, or export the .fit and upload it by hand."
	default:
		return "Strava could not be reached. It will be retried; you can also retry now."
	}
}
