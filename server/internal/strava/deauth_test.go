package strava

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// The two refusals a token endpoint gives, shaped as Strava shapes them: one
// names the rider's refresh token, the other our application.
const (
	grantRevokedBody = `{"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}`
	badClientBody    = `{"message":"Bad Request","errors":[{"resource":"Application","field":"client_id","code":"invalid"}]}`
)

// refusingStrava is a Strava whose token endpoint answers refusal (a 400 with
// that body) when it is set, and whose upload endpoint answers 401 when
// unauthorized is. Otherwise it refreshes any grant and accepts any upload.
func refusingStrava(t *testing.T) (srv *httptest.Server, refusal *atomic.Pointer[string], unauthorized *atomic.Bool, refreshes *atomic.Int32) {
	t.Helper()
	refusal, unauthorized, refreshes = &atomic.Pointer[string]{}, &atomic.Bool{}, &atomic.Int32{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth/token", func(w http.ResponseWriter, _ *http.Request) {
		refreshes.Add(1)
		if body := refusal.Load(); body != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(*body))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "fresh-token", "refresh_token": "refresh-rotated",
			"expires_at": time.Now().Add(6 * time.Hour).Unix(),
		})
	})
	mux.HandleFunc("POST /api/v3/uploads", func(w http.ResponseWriter, _ *http.Request) {
		if unauthorized.Load() {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 777})
	})
	mux.HandleFunc("GET /api/v3/uploads/777", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"activity_id": 4242})
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, refusal, unauthorized, refreshes
}

// forgetting records what the auth routine would have been handed.
func forgetting(svc *Service) chan db.Identity {
	forgot := make(chan db.Identity, 4)
	svc.SetGrantForgetter(func(_ context.Context, ident db.Identity) error {
		forgot <- ident
		return nil
	})
	return forgot
}

func exportRow(t *testing.T, st *store.Store, ride pgtype.UUID) db.GetRideExportRow {
	t.Helper()
	row, err := st.Queries.GetRideExport(t.Context(), db.GetRideExportParams{RideID: ride, Destination: Destination})
	if err != nil {
		t.Fatalf("read delivery: %v", err)
	}
	return row
}

// A refresh Strava refuses because the rider revoked WattRoom forgets the
// grant, and the delivery fails at once rather than spending four more
// attempts on the same refusal (#2823).
func TestARevokedGrantIsForgottenByTheUpload(t *testing.T) {
	st, _, rideID := seedRide(t, "strava-revoked")
	srv, refusal, _, _ := refusingStrava(t)
	body := grantRevokedBody
	refusal.Store(&body)
	svc := newService(st, srv)
	forgot := forgetting(svc)

	svc.deliver(t.Context(), rideID)

	select {
	case ident := <-forgot:
		if ident.ProviderUserID != "athlete-1" {
			t.Fatalf("forgot %q, want the ride owner's grant", ident.ProviderUserID)
		}
	default:
		t.Fatal("a revoked grant was not forgotten")
	}
	row := exportRow(t, st, rideID)
	if row.State != "failed" || row.Attempts != 1 {
		t.Errorf("delivery = %s after %d attempts, want failed after 1", row.State, row.Attempts)
	}
	if row.LastError == nil || !strings.Contains(*row.LastError, "reconnect Strava") {
		t.Errorf("the rider was told %v", row.LastError)
	}
}

// What must never read as every rider revoking at once: our own credentials
// refused, and an upload refused for a reason the grant survives.
func TestRefusalsThatAreNotARevocationForgetNothing(t *testing.T) {
	t.Run("the application's credentials", func(t *testing.T) {
		st, _, rideID := seedRide(t, "strava-bad-client")
		srv, refusal, _, _ := refusingStrava(t)
		body := badClientBody
		refusal.Store(&body)
		svc := newService(st, srv)
		forgot := forgetting(svc)

		svc.deliver(t.Context(), rideID)
		if len(forgot) != 0 {
			t.Fatal("a refused client forgot the rider's grant")
		}
		if row := exportRow(t, st, rideID); row.State != "pending" {
			t.Errorf("delivery = %s, want pending: an operator's mistake is retried", row.State)
		}
	})
	t.Run("a 401 on the upload while the grant still refreshes", func(t *testing.T) {
		st, _, rideID := seedRide(t, "strava-scope")
		srv, _, unauthorized, refreshes := refusingStrava(t)
		unauthorized.Store(true)
		svc := newService(st, srv)
		forgot := forgetting(svc)

		svc.deliver(t.Context(), rideID)
		if len(forgot) != 0 {
			t.Fatal("a 401 Strava would still refresh forgot the grant")
		}
		if n := refreshes.Load(); n != 2 {
			t.Errorf("refreshes = %d, want 2: the upload's, then the one that asks", n)
		}
	})
}

// A 401 on the upload is asked again, and forgotten when the refresh is
// refused too — the grant was revoked while its access token still looked
// valid to us.
func TestAn401ConfirmedByTheRefreshIsForgotten(t *testing.T) {
	st, userID, rideID := seedRide(t, "strava-401-revoked")
	// A current access token, so the upload goes out without a refresh.
	access := "still-looks-valid"
	refresh := "refresh-1"
	if err := st.Queries.UpdateIdentityTokens(t.Context(), db.UpdateIdentityTokensParams{
		Provider: "strava", ProviderUserID: "athlete-1", AccessToken: &access, RefreshToken: &refresh,
		TokenExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	srv, refusal, unauthorized, _ := refusingStrava(t)
	unauthorized.Store(true)
	body := grantRevokedBody
	refusal.Store(&body)
	svc := newService(st, srv)
	forgot := forgetting(svc)

	svc.deliver(t.Context(), rideID)
	select {
	case ident := <-forgot:
		if ident.UserID != userID {
			t.Fatal("forgot somebody else's grant")
		}
	default:
		t.Fatal("a confirmed revocation was not forgotten")
	}
	if row := exportRow(t, st, rideID); row.State != "failed" {
		t.Errorf("delivery = %s, want failed", row.State)
	}
}

func webhookService(t *testing.T, st *store.Store, srv *httptest.Server) (*Service, *http.ServeMux) {
	t.Helper()
	svc := newService(st, srv)
	svc.verifyToken = "verify-me"
	svc.confirms = budget.New[string](1, confirmEvery)
	mux := http.NewServeMux()
	svc.Register(mux)
	return svc, mux
}

// Strava confirms the callback when the subscription is created, and only
// the operator's token gets its challenge back.
func TestWebhookChallenge(t *testing.T) {
	st := storetest.Open(t)
	srv, _, _, _ := refusingStrava(t)
	_, mux := webhookService(t, st, srv)
	for _, c := range []struct {
		query string
		code  int
	}{
		{"hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123", http.StatusOK},
		{"hub.mode=subscribe&hub.verify_token=guess&hub.challenge=abc123", http.StatusForbidden},
		{"hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=abc123", http.StatusForbidden},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/strava/webhook?"+c.query, nil))
		if rec.Code != c.code {
			t.Errorf("%s = %d, want %d", c.query, rec.Code, c.code)
		}
		if c.code == http.StatusOK && !strings.Contains(rec.Body.String(), `"hub.challenge":"abc123"`) {
			t.Errorf("challenge not echoed: %s", rec.Body.String())
		}
	}
	// No verify token configured: no webhook at all.
	bare := http.NewServeMux()
	newService(st, srv).Register(bare)
	rec := httptest.NewRecorder()
	bare.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/strava/webhook", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("unconfigured webhook = %d, want 404", rec.Code)
	}
}

// An athlete's deauthorization event forgets their grant once Strava confirms
// it — and, since Strava signs nothing, only then: an event for a grant that
// still refreshes is somebody guessing.
func TestWebhookDeauthorization(t *testing.T) {
	st, userID, _ := seedRide(t, "strava-webhook")
	athlete := time.Now().UnixNano() % 1_000_000_000_000
	if _, err := st.Pool.Exec(t.Context(),
		"update identities set provider_user_id = $2 where user_id = $1 and provider = 'strava'",
		userID, strconv.FormatInt(athlete, 10)); err != nil {
		t.Fatal(err)
	}
	srv, refusal, _, refreshes := refusingStrava(t)
	svc, mux := webhookService(t, st, srv)
	forgot := forgetting(svc)
	event := func(body string) int {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/strava/webhook", strings.NewReader(body)))
		return rec.Code
	}
	deauth := `{"object_type":"athlete","aspect_type":"update","owner_id":` + strconv.FormatInt(athlete, 10) +
		`,"object_id":` + strconv.FormatInt(athlete, 10) + `,"updates":{"authorized":"false"},"subscription_id":1}`
	waitRefreshes := func(n int32) {
		t.Helper()
		for deadline := time.Now().Add(5 * time.Second); refreshes.Load() < n; {
			if time.Now().After(deadline) {
				t.Fatalf("refreshes = %d, want %d", refreshes.Load(), n)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}

	// The grant still refreshes: a forged event, ignored.
	if code := event(deauth); code != http.StatusOK {
		t.Fatalf("event = %d, want 200", code)
	}
	waitRefreshes(1)
	select {
	case <-forgot:
		t.Fatal("an event for a live grant forgot it")
	case <-time.After(100 * time.Millisecond):
	}

	// Within the window a second event is not even asked about.
	body := grantRevokedBody
	refusal.Store(&body)
	event(deauth)
	time.Sleep(100 * time.Millisecond)
	if n := refreshes.Load(); n != 1 {
		t.Fatalf("refreshes = %d inside the window, want 1", n)
	}

	// A fresh window, and now Strava refuses the grant: forgotten.
	svc.confirms = budget.New[string](1, confirmEvery)
	event(deauth)
	select {
	case ident := <-forgot:
		if ident.UserID != userID {
			t.Fatal("forgot somebody else's grant")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a confirmed deauthorization was not forgotten")
	}

	// Anything else is acknowledged and left alone; nobody we hold costs no
	// refresh.
	before := refreshes.Load()
	for _, other := range []string{
		`{"object_type":"activity","aspect_type":"create","owner_id":` + strconv.FormatInt(athlete, 10) + `,"updates":{}}`,
		`{"object_type":"athlete","aspect_type":"update","owner_id":1,"updates":{"authorized":"false"}}`,
	} {
		if code := event(other); code != http.StatusOK {
			t.Errorf("event = %d, want 200", code)
		}
	}
	time.Sleep(100 * time.Millisecond)
	if refreshes.Load() != before {
		t.Error("an event that is not ours cost a refresh")
	}
	if code := event("not json"); code != http.StatusBadRequest {
		t.Errorf("unreadable event = %d, want 400", code)
	}
}
