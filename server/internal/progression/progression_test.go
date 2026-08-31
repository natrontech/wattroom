package progression

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

func setup(t *testing.T) (*http.ServeMux, *store.Store, db.User) {
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

	u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "alice", FtpWatts: 250, WeightKg: 70,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	users := &fakeUsers{byToken: map[string]db.User{"alice": u}}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return mux, st, u
}

func addRide(t *testing.T, st *store.Store, user db.User, daysAgo int, best20m int) {
	t.Helper()
	curve, _ := json.Marshal(map[string]int{
		"best5s": best20m + 100, "best1m": best20m + 50, "best5m": best20m + 20, "best20m": best20m,
	})
	_, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "test ride",
		StartedAt: pgtype.Timestamptz{Time: time.Now().AddDate(0, 0, -daysAgo), Valid: true},
		Seconds:   3600, AvgWatts: 200, Kj: 720, Execution: 0.9, FtpWatts: user.FtpWatts,
		Samples: []byte("x"), Curve: curve, Xp: 100,
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}
}

type bodyJSON struct {
	Error string `json:"error"`
	Curve struct {
		D90 struct {
			Best20m int `json:"best20m"`
		} `json:"d90"`
		All struct {
			Best20m int `json:"best20m"`
		} `json:"all"`
	} `json:"curve"`
	Rides []struct {
		Ftp     int `json:"ftp"`
		Best20m int `json:"best20m"`
	} `json:"rides"`
	Category string `json:"category"`
	Load     *struct {
		Building bool    `json:"building"`
		Fitness  float64 `json:"fitness"`
		Zone     string  `json:"zone"`
		Series   []struct {
			Date string `json:"date"`
		} `json:"series"`
	} `json:"load"`
}

func get(t *testing.T, mux *http.ServeMux, user string) (int, bodyJSON) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/progression", nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var body bodyJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad response body: %v", err)
	}
	return rec.Code, body
}

func TestUnauthorized(t *testing.T) {
	mux, _, _ := setup(t)
	code, body := get(t, mux, "")
	if code != http.StatusUnauthorized || body.Error != "unauthorized" {
		t.Fatalf("got %d %+v", code, body)
	}
}

func TestEmptyHistory(t *testing.T) {
	mux, _, _ := setup(t)
	code, body := get(t, mux, "alice")
	if code != http.StatusOK {
		t.Fatalf("got %d %+v", code, body)
	}
	if len(body.Rides) != 0 {
		t.Fatalf("expected no rides, got %+v", body.Rides)
	}
	if body.Category != "D" {
		t.Fatalf("empty history is category D, got %v", body.Category)
	}
}

func TestTrends(t *testing.T) {
	mux, st, u := setup(t)
	addRide(t, st, u, 100, 260) // outside 90 d, inside the 365 d trend window
	addRide(t, st, u, 5, 230)

	code, body := get(t, mux, "alice")
	if code != http.StatusOK {
		t.Fatalf("got %d %+v", code, body)
	}
	if body.Curve.D90.Best20m != 230 {
		t.Fatalf("d90 best20m: got %d, want 230", body.Curve.D90.Best20m)
	}
	if body.Curve.All.Best20m != 260 {
		t.Fatalf("all-time best20m: got %d, want 260", body.Curve.All.Best20m)
	}
	if len(body.Rides) != 2 {
		t.Fatalf("expected 2 trend rows, got %d", len(body.Rides))
	}
	if body.Rides[0].Best20m != 260 {
		t.Fatalf("rows must be oldest first, got %+v", body.Rides[0])
	}
	if body.Rides[0].Ftp != 250 {
		t.Fatalf("ftp at ride time: got %d", body.Rides[0].Ftp)
	}
	// 230 W / 70 kg = 3.29 w/kg → Category B per SPEC.
	if body.Category != "B" {
		t.Fatalf("category: got %v, want B", body.Category)
	}
	if body.Load == nil {
		t.Fatal("load block missing with ride history present")
	}
	if body.Load.Building {
		t.Fatal("140 days of history is past the 28-day cold start")
	}
	if body.Load.Fitness <= 0 || body.Load.Zone == "" {
		t.Fatalf("load block not computed: %+v", body.Load)
	}
	if len(body.Load.Series) == 0 || len(body.Load.Series) > 120 {
		t.Fatalf("series must cover at most 120 days, got %d", len(body.Load.Series))
	}
}

func TestEmptyHistoryHasNoLoad(t *testing.T) {
	mux, _, _ := setup(t)
	_, body := get(t, mux, "alice")
	if body.Load != nil {
		t.Fatalf("no rides must mean no load block, got %+v", body.Load)
	}
}
