// A grant the rider took back on Strava's side (#2823): at
// strava.com/settings/apps, the usual way to revoke an app, which never passes
// through our disconnect. WATTROOM.md binds §7.4 — everything goes within 30
// days of deauthorization — so the tokens and the activity ids go when Strava
// says so, by its push webhook, or when an upload finds out the hard way.
package strava

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// errGrantRevoked is Strava refusing to refresh a grant because the rider
// took it back — never a Strava outage, never our own credentials being wrong.
var errGrantRevoked = errors.New("strava grant revoked")

// GrantForgetter drops what a revoked grant leaves with us; the auth package
// owns it because it owns the rule about an account's last credential.
type GrantForgetter func(ctx context.Context, ident db.Identity) error

// SetGrantForgetter wires auth's routine in after construction, the way
// SetStravaRevoker wires this package into auth.
func (s *Service) SetGrantForgetter(f GrantForgetter) { s.forget = f }

// Operational guards, not product numbers.
const (
	// How often one athlete's deauthorization may be checked with Strava.
	// The event is unsigned, so each one costs a refresh against the
	// application's rate limit; a real one arrives once.
	confirmEvery = 15 * time.Minute
	// Strava's events are a few hundred bytes.
	maxEventBytes = 16 << 10
)

// revoked asks Strava the one question an unsigned event cannot fake: will it
// still refresh this grant? The identity is read again first, since the
// caller's copy may hold a refresh token a refresh has since rotated.
func (s *Service) revoked(ctx context.Context, providerUserID string) (db.Identity, bool) {
	ident, err := s.store.Queries.GetIdentity(ctx, db.GetIdentityParams{
		Provider: "strava", ProviderUserID: providerUserID,
	})
	if err != nil {
		return db.Identity{}, false
	}
	stale := ident
	stale.TokenExpiresAt = pgtype.Timestamptz{} // expired, so freshToken refreshes
	_, err = s.freshToken(ctx, stale)
	return ident, errors.Is(err, errGrantRevoked)
}

// grantGone reports whether err means the rider revoked WattRoom on Strava,
// and forgets the grant when it does. A refused refresh says so outright; a
// 401 on an upload is also what a missing scope looks like, so that one is
// asked again before anything is forgotten.
func (s *Service) grantGone(ctx context.Context, ident db.Identity, err error) bool {
	var refused *uploadRefused
	gone := errors.Is(err, errGrantRevoked)
	if !gone && errors.As(err, &refused) && refused.status == http.StatusUnauthorized {
		ident, gone = s.revoked(ctx, ident.ProviderUserID)
	}
	if gone {
		s.forgetGrant(ctx, ident)
	}
	return gone
}

func (s *Service) forgetGrant(ctx context.Context, ident db.Identity) {
	if s.forget == nil {
		return
	}
	if err := s.forget(ctx, ident); err != nil {
		s.log.Warn("strava grant revoked on strava, not forgotten", "user", ident.UserID, "err", err)
		return
	}
	s.log.Info("strava grant revoked on strava, forgotten", "user", ident.UserID)
}

// Register mounts Strava's push webhook when the operator has set its verify
// token; without one there is no subscription to answer. The subscription
// itself is created once, by the operator, against Strava's API
// (deploy/.env.example has the call).
func (s *Service) Register(mux *http.ServeMux) {
	if s.verifyToken == "" {
		return
	}
	mux.HandleFunc("GET /api/strava/webhook", s.handleWebhookChallenge)
	mux.HandleFunc("POST /api/strava/webhook", s.handleWebhookEvent)
}

// handleWebhookChallenge is Strava confirming the callback when the
// subscription is created: echo the challenge if the token is ours.
func (s *Service) handleWebhookChallenge(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("hub.mode") != "subscribe" ||
		subtle.ConstantTimeCompare([]byte(q.Get("hub.verify_token")), []byte(s.verifyToken)) != 1 {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "That is not WattRoom's Strava subscription.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"hub.challenge": q.Get("hub.challenge")})
}

type webhookEvent struct {
	ObjectType string         `json:"object_type"`
	OwnerID    int64          `json:"owner_id"`
	Updates    map[string]any `json:"updates"`
}

// handleWebhookEvent acts on one event: an athlete taking the grant back.
// Anything else is acknowledged and ignored — an upload-only app has no use
// for activity events. Strava signs nothing, so the event is only a reason to
// ask (revoked); and it wants its 200 within two seconds, which a refresh
// cannot promise, so the asking happens after the answer.
func (s *Service) handleWebhookEvent(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxEventBytes)
	var ev webhookEvent
	if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That event could not be read.")
		return
	}
	// Documented as a boolean, delivered as the string "false".
	authorized := ev.Updates["authorized"]
	if ev.ObjectType == "athlete" && (authorized == false || authorized == "false") {
		athlete := strconv.FormatInt(ev.OwnerID, 10)
		_, err := s.store.Queries.GetIdentity(r.Context(), db.GetIdentityParams{Provider: "strava", ProviderUserID: athlete})
		// Spent only for an athlete we hold, so a flood of invented ids can
		// neither grow the budget nor starve a real one.
		if err == nil && s.confirms.Spend(athlete) {
			safego.Go(s.log, "strava deauthorization", func() {
				ctx, cancel := context.WithTimeout(context.Background(), attemptBudget)
				defer cancel()
				if ident, gone := s.revoked(ctx, athlete); gone {
					s.forgetGrant(ctx, ident)
				}
			})
		}
	}
	w.WriteHeader(http.StatusOK)
}
