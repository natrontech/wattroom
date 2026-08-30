package strava

import (
	"bytes"
	"compress/gzip"
	"context"
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

func TestUploadRefreshesPostsAndPolls(t *testing.T) {
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
		DisplayName: "strava-test", FtpWatts: 250, WeightKg: 70,
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

	srv, uploads, polls := fakeStrava(t)
	svc := &Service{
		store: st, log: slog.New(slog.DiscardHandler),
		clientID: "id", clientSecret: "secret",
		apiBase: srv.URL + "/api/v3", tokenURL: srv.URL + "/oauth/token",
		httpc: srv.Client(), now: time.Now, pollEvery: 10 * time.Millisecond,
	}
	if err := svc.upload(t.Context(), rideID); err != nil {
		t.Fatalf("upload: %v", err)
	}
	if uploads.Load() != 1 || polls.Load() < 2 {
		t.Fatalf("uploads=%d polls=%d", uploads.Load(), polls.Load())
	}
	// The refreshed tokens persisted for next time.
	ident, err := st.Queries.GetUserIdentity(t.Context(), db.GetUserIdentityParams{
		UserID: user.ID, Provider: "strava",
	})
	if err != nil || *ident.AccessToken != "fresh-token" || *ident.RefreshToken != "refresh-2" {
		t.Fatalf("tokens not persisted: %+v err %v", ident, err)
	}

	// The rider's off switch short-circuits before any HTTP.
	if _, err := st.Pool.Exec(t.Context(), "update users set strava_upload = false where id = $1", user.ID); err != nil {
		t.Fatal(err)
	}
	before := uploads.Load()
	if err := svc.upload(t.Context(), rideID); err != nil {
		t.Fatalf("opted-out upload errored: %v", err)
	}
	if uploads.Load() != before {
		t.Fatal("opt-out still uploaded")
	}
}
