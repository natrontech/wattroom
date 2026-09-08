package strava

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The fake Strava: token refresh, upload accept, then one "processing" poll
// before the activity settles — the async path #34 specifies.
func fakeStrava(t *testing.T) (*httptest.Server, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	var uploads, polls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth/token", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		if r.FormValue("grant_type") != "refresh_token" || r.FormValue("refresh_token") != "refresh-1" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "fresh-token", "refresh_token": "refresh-2",
			"expires_at": time.Now().Add(6 * time.Hour).Unix(),
		})
	})
	mux.HandleFunc("POST /api/v3/uploads", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fresh-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		if err := r.ParseMultipartForm(8 << 20); err != nil || //nolint:gosec // test fake; body capped by MaxBytesReader above
			r.FormValue("data_type") != "fit" || r.FormValue("name") == "" ||
			r.FormValue("external_id") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		head := make([]byte, 12)
		_, _ = file.Read(head)
		// A .fit file carries the ".FIT" magic at offset 8.
		if string(head[8:12]) != ".FIT" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		uploads.Add(1)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 777})
	})
	mux.HandleFunc("GET /api/v3/uploads/777", func(w http.ResponseWriter, _ *http.Request) {
		if polls.Add(1) < 2 {
			_ = json.NewEncoder(w).Encode(map[string]any{"activity_id": nil})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"activity_id": 4242})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &uploads, &polls
}

// seedRide gives a test a rider with Strava connected and one saved ride.
func seedRide(t *testing.T, name string) (*store.Store, pgtype.UUID, pgtype.UUID) {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

	user, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: name, FtpWatts: 250, WeightKg: 70,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", user.ID)
	})
	stale := "stale"
	refresh := "refresh-1"
	err = st.Queries.CreateIdentity(t.Context(), db.CreateIdentityParams{
		Provider: "strava", ProviderUserID: "athlete-1", UserID: user.ID,
		AccessToken: &stale, RefreshToken: &refresh,
		TokenExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	samples := make([]protocol.RiderMetrics, 90)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: i}
	}
	var blob bytes.Buffer
	zw := gzip.NewWriter(&blob)
	if err := json.NewEncoder(zw).Encode(samples); err != nil {
		t.Fatal(err)
	}
	_ = zw.Close()
	rideID, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		Seconds:   90, AvgWatts: 200, Kj: 18, Execution: 1, FtpWatts: 250,
		Samples: blob.Bytes(), Curve: []byte(`{}`), Xp: 18,
	})
	if err != nil {
		t.Fatal(err)
	}

	return st, user.ID, rideID
}

func newService(st *store.Store, srv *httptest.Server) *Service {
	return &Service{
		store: st, log: slog.New(slog.DiscardHandler),
		clientID: "id", clientSecret: "secret",
		apiBase: srv.URL + "/api/v3", tokenURL: srv.URL + "/oauth/token",
		httpc: srv.Client(), now: time.Now, pollEvery: 10 * time.Millisecond,
	}
}

func TestUploadRefreshesPostsAndPolls(t *testing.T) {
	st, userID, rideID := seedRide(t, "strava-test")
	srv, uploads, polls := fakeStrava(t)
	svc := newService(st, srv)
	activityID, err := svc.upload(t.Context(), rideID)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if activityID == nil {
		t.Fatal("a delivered ride reported no activity id")
	}
	if uploads.Load() != 1 || polls.Load() < 2 {
		t.Fatalf("uploads=%d polls=%d", uploads.Load(), polls.Load())
	}
	// The refreshed tokens persisted for next time.
	ident, err := st.Queries.GetUserIdentity(t.Context(), db.GetUserIdentityParams{
		UserID: userID, Provider: "strava",
	})
	if err != nil || *ident.AccessToken != "fresh-token" || *ident.RefreshToken != "refresh-2" {
		t.Fatalf("tokens not persisted: %+v err %v", ident, err)
	}

	// The rider's off switch short-circuits before any HTTP.
	if _, err := st.Pool.Exec(t.Context(), "update users set strava_upload = false where id = $1", userID); err != nil {
		t.Fatal(err)
	}
	before := uploads.Load()
	if _, err := svc.upload(t.Context(), rideID); err != nil {
		t.Fatalf("opted-out upload errored: %v", err)
	}
	if uploads.Load() != before {
		t.Fatal("opt-out still uploaded")
	}
}

// A Strava that refuses the upload, until it is told to stop refusing.
func flakyStrava(t *testing.T) (*httptest.Server, *atomic.Bool, *atomic.Int32) {
	t.Helper()
	srv, uploads, _ := fakeStrava(t)
	var down atomic.Bool
	down.Store(true)
	inner := srv.Config.Handler
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if down.Load() && r.URL.Path == "/api/v3/uploads" {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		inner.ServeHTTP(w, r)
	})
	return srv, &down, uploads
}

func TestDeliveryOutlivesTheGoroutineThatStartedIt(t *testing.T) {
	// #799: delivery used to live entirely in a 90-second goroutine. A Strava
	// outage or a restart abandoned it after the ride was saved, and nothing
	// remembered — not the database, not the rider's screen.
	st, _, rideID := seedRide(t, "strava-retry")
	srv, down, uploads := flakyStrava(t)
	svc := newService(st, srv)
	exportOf := func() db.GetRideExportRow {
		t.Helper()
		row, err := st.Queries.GetRideExport(t.Context(), db.GetRideExportParams{
			RideID: rideID, Destination: Destination,
		})
		if err != nil {
			t.Fatalf("no delivery record: %v", err)
		}
		return row
	}

	svc.deliver(t.Context(), rideID)
	first := exportOf()
	if first.State != "pending" || first.Attempts != 1 {
		t.Fatalf("a refused upload should stay pending with one attempt: %+v", first)
	}
	if first.LastError == nil || *first.LastError == "" {
		t.Error("the failure was not recorded")
	}

	// The sweep is what picks it up again — with the clock wound past the
	// backoff, since a real one waits minutes.
	down.Store(false)
	svc.now = func() time.Time { return time.Now().Add(time.Hour) }
	svc.sweepOnce(t.Context())
	done := exportOf()
	if done.State != "delivered" {
		t.Fatalf("the retry did not deliver: %+v", done)
	}
	if done.RemoteID == nil || *done.RemoteID != 4242 {
		t.Errorf("the activity id was not kept: %+v", done.RemoteID)
	}
	if done.LastError != nil {
		t.Errorf("a delivered ride kept its old error: %q", *done.LastError)
	}
	if uploads.Load() != 1 {
		t.Errorf("uploads=%d, want exactly the one that worked", uploads.Load())
	}

	// And a delivered ride is not swept again — one delivery per pair, ever.
	svc.sweepOnce(t.Context())
	if uploads.Load() != 1 {
		t.Errorf("a delivered ride was uploaded twice (uploads=%d)", uploads.Load())
	}
}

func TestDeliveryStopsAfterItsAttempts(t *testing.T) {
	// Retried at forever is worse than told: past the ceiling the row goes to
	// failed, stops being swept, and the ride page says so.
	st, _, rideID := seedRide(t, "strava-giveup")
	srv, _, _ := flakyStrava(t)
	svc := newService(st, srv)
	for i := 0; i < maxAttempts; i++ {
		svc.deliver(t.Context(), rideID)
	}
	row, err := st.Queries.GetRideExport(t.Context(), db.GetRideExportParams{
		RideID: rideID, Destination: Destination,
	})
	if err != nil {
		t.Fatalf("no delivery record: %v", err)
	}
	if row.State != "failed" || row.Attempts != maxAttempts {
		t.Fatalf("want failed after %d attempts, got %+v", maxAttempts, row)
	}
	svc.now = func() time.Time { return time.Now().Add(24 * time.Hour) }
	svc.sweepOnce(t.Context())
	after, _ := st.Queries.GetRideExport(t.Context(), db.GetRideExportParams{
		RideID: rideID, Destination: Destination,
	})
	if after.Attempts != maxAttempts {
		t.Errorf("a failed delivery was swept again: %+v", after)
	}
}

/*
TestRevokeSendsTheTokenInTheBodyNotTheURL is the regression this migration
exists for (#1093). The interesting failure is silent: a revoke that keeps
working while leaking the token into a query string passes any test that only
checks the error, because Strava answers 200 either way.

So the fake asserts the shape rather than the outcome — Basic auth from the
client, the token in the form body, and nothing token-shaped in the URL.
*/
func TestRevokeSendsTheTokenInTheBodyNotTheURL(t *testing.T) {
	st, _, _ := seedRide(t, "Revoker")

	var gotAuth, gotToken, gotHint, gotQuery string
	var calls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth/token", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "fresh-token", "refresh_token": "refresh-2",
			"expires_at": time.Now().Add(time.Hour).Unix(),
		})
	})
	mux.HandleFunc("POST /oauth/revoke", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		gotAuth = r.Header.Get("Authorization")
		gotQuery = r.URL.RawQuery
		_ = r.ParseForm()
		gotToken, gotHint = r.PostFormValue("token"), r.PostFormValue("token_type_hint")
		w.WriteHeader(http.StatusOK) // revoke is 200 whether or not it knew the token
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	svc := newService(st, srv)
	svc.revokeURL = srv.URL + "/oauth/revoke"
	ident, err := st.Queries.GetIdentity(t.Context(),
		db.GetIdentityParams{Provider: "strava", ProviderUserID: "athlete-1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RevokeGrant(t.Context(), ident); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	if calls.Load() != 1 {
		t.Fatalf("revoke called %d times, want 1", calls.Load())
	}
	// The token is the body's, and the URL carries nothing at all.
	if gotToken != "fresh-token" {
		t.Errorf("form token = %q, want the refreshed access token", gotToken)
	}
	if gotHint != "access_token" {
		t.Errorf("token_type_hint = %q, want access_token", gotHint)
	}
	if gotQuery != "" {
		t.Errorf("revoke URL carried a query string %q — a token in a URL is what this fixed", gotQuery)
	}
	// The client authenticates, not the token: Basic base64("id:secret").
	if want := "Basic " + base64.StdEncoding.EncodeToString([]byte("id:secret")); gotAuth != want {
		t.Errorf("Authorization = %q, want %q", gotAuth, want)
	}
}

// A non-200 is now an error rather than something swallowed: under the old
// endpoint a 401 meant "already gone", under revoke it means our client
// credentials are wrong, and every rider's disconnect would fail quietly.
func TestRevokeReportsARefusal(t *testing.T) {
	st, _, _ := seedRide(t, "Refused")

	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth/token", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "fresh-token", "refresh_token": "refresh-2",
			"expires_at": time.Now().Add(time.Hour).Unix(),
		})
	})
	mux.HandleFunc("POST /oauth/revoke", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	svc := newService(st, srv)
	svc.revokeURL = srv.URL + "/oauth/revoke"
	ident, err := st.Queries.GetIdentity(t.Context(),
		db.GetIdentityParams{Provider: "strava", ProviderUserID: "athlete-1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RevokeGrant(t.Context(), ident); err == nil {
		t.Fatal("a 401 from revoke was swallowed — bad client credentials must not read as success")
	}
}
