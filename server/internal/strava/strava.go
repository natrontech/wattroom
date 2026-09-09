// Package strava is the auto-upload worker (#34): a finished ride, encoded
// as the .fit the export already produces, posted to the rider's OWN Strava.
// Upload-only is locked (WATTROOM.md) — nothing is ever pulled back or shown
// to anyone else. Single-athlete mode until the Standard Tier request.
package strava

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/secrets"
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
	revokeURL string
	httpc     *http.Client
	now       func() time.Time
	pollEvery time.Duration
	// A rate limit is against the application, so it parks every delivery
	// rather than one (#1158). Guarded because the sweep goroutine and a
	// RideSaved goroutine both read it.
	holdMu    sync.Mutex
	holdUntil time.Time
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
		tokenURL:  "https://www.strava.com/oauth/token",  //nolint:gosec // a public endpoint URL, not a credential
		revokeURL: "https://www.strava.com/oauth/revoke", //nolint:gosec // likewise
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
	// How quiet a pending row must be before the sweep picks it up again, and
	// the first step of the backoff.
	retryBase = 5 * time.Minute
	// The ceiling on one delivery's wait, so a widening backoff stays a
	// backoff rather than becoming a retirement.
	retryCap = 2 * time.Hour
	// How long every delivery waits when Strava says slow down, absent a
	// usable Retry-After. Their limits are quarter-hourly, so anything
	// shorter is asking again inside the same window.
	defaultRateLimitHold = 15 * time.Minute
	// …and the most we will honour from the header, so a stray value cannot
	// park uploads for a day.
	maxRateLimitHold = time.Hour
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
	if s.held() {
		return
	}
	due, err := s.store.Queries.ListRideExportsDue(ctx, db.ListRideExportsDueParams{
		Before:  pgtype.Timestamptz{Time: s.now().Add(-retryBase), Valid: true},
		MaxRows: sweepBatch,
	})
	if err != nil {
		s.log.Warn("strava sweep query failed", "err", err)
		return
	}
	for _, row := range due {
		// The widening, off the same injectable clock; the query has already
		// applied the first step of it.
		if row.UpdatedAt.Time.After(s.now().Add(-backoffFor(row.Attempts))) {
			continue
		}
		attemptCtx, cancel := context.WithTimeout(ctx, attemptBudget)
		s.deliver(attemptCtx, row.RideID)
		cancel()
		if ctx.Err() != nil {
			return
		}
		// A rate limit mid-batch stops the batch. Working through the other
		// nineteen is the behaviour that provoked it.
		if s.held() {
			return
		}
	}
}

// backoffFor is how long a delivery waits after N failed attempts.
//
// Exponential, not linear (#1158). `attempts × retryBase` gave 5 + 10 + 15 +
// 20 minutes, so all five attempts were gone about fifty minutes after the
// first failure — while the comment above retryBase promised an outage was
// "retried over hours, not hammered for a minute". Doubling keeps the same
// five attempts and makes that sentence true; the cap stops it running away.
func backoffFor(attempts int32) time.Duration {
	if attempts < 1 {
		return retryBase
	}
	wait := retryBase << min(attempts-1, 16)
	return min(wait, retryCap)
}

// rateLimited is Strava telling us to slow down. It is NOT a delivery
// failure: nothing about the ride is wrong, and spending one of five
// attempts on it turns their throttle into our data loss (#1158).
type rateLimited struct{ after time.Duration }

func (e *rateLimited) Error() string {
	return fmt.Sprintf("rate limited, retry after %s", e.after)
}

// retryAfterOf reads the header if it is there, and otherwise picks a wait
// long enough to be worth calling a wait. Strava's limits are quarter-hourly,
// so a minute is the smallest number that means anything.
func retryAfterOf(res *http.Response) time.Duration {
	if v := res.Header.Get("Retry-After"); v != "" {
		if secs, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && secs > 0 {
			return min(time.Duration(secs)*time.Second, maxRateLimitHold)
		}
	}
	return defaultRateLimitHold
}

// holdFor parks every delivery, not just this one. A rate limit is against
// the APPLICATION, so continuing down the batch is precisely the hammering —
// and a backlog is exactly when a batch is full, which is exactly after an
// outage.
func (s *Service) holdFor(d time.Duration) {
	s.holdMu.Lock()
	defer s.holdMu.Unlock()
	until := s.now().Add(d)
	if until.After(s.holdUntil) {
		s.holdUntil = until
	}
}

// held says whether we are still inside a hold.
func (s *Service) held() bool {
	s.holdMu.Lock()
	defer s.holdMu.Unlock()
	return s.now().Before(s.holdUntil)
}

// deliver runs one attempt and records what happened to it.
func (s *Service) deliver(ctx context.Context, rideID pgtype.UUID) {
	activityID, err := s.upload(ctx, rideID)
	var limit *rateLimited
	switch {
	case errors.As(err, &limit):
		// No FailRideExport: being told to slow down is not the delivery
		// failing, so it costs no attempt and the row stays pending exactly
		// as it was. The whole sweep waits instead.
		s.holdFor(limit.after)
		s.log.Warn("strava rate limited, holding deliveries",
			"for", limit.after, "ride", store.UUIDString(rideID))
	case err != nil:
		s.log.Warn("strava upload failed", "err", err, "ride", store.UUIDString(rideID))
		message := exportFailure(err)
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

/*
RevokeGrant hands the rider's authorization back to Strava when they disconnect
it (#783). Dropping our row while Strava still lists WattRoom among their
connected apps would tell them something untrue.

This is `oauth/revoke` (RFC 7009 in shape), not the `oauth/deauthorize` it
replaces: the token being revoked travels in the form body and the *client*
authenticates with Basic auth, so no token is ever written into a URL where a
proxy log would keep it. Strava retires `deauthorize` on 2027-06-01 (#1093).

The refresh is not ceremony. Revoke answers 200 whether or not it recognised
the token, so revoking a token we merely believe in would report success while
the grant lived on — and a grant nobody has used for months is exactly the one
being disconnected. Refreshing first makes Strava vouch for the token before we
revoke it, which turns that silent case into an error. Revoking an access token
takes its refresh token with it, so one call ends the grant.
*/
