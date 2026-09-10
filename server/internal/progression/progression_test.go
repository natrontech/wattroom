package progression

import (
	"context"
	"encoding/json"
	"github.com/natrontech/wattroom/server/internal/testx"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

func setup(t *testing.T) (*http.ServeMux, *store.Store, db.User) {
	t.Helper()
	st := storetest.Open(t)

	u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "alice", FtpWatts: 250, WeightKg: 70,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	users := &testx.Users{ByToken: map[string]db.User{"alice": u}}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return mux, st, u
}

// Returns the row's id — the FTP a ramp produced is stamped onto one (#1572).
func addRide(t *testing.T, st *store.Store, user db.User, daysAgo int, best20m int) pgtype.UUID {
	t.Helper()
	curve, _ := json.Marshal(map[string]int{
		"best5s": best20m + 100, "best1m": best20m + 50, "best5m": best20m + 20, "best20m": best20m,
	})
	id, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "test ride",
		StartedAt: pgtype.Timestamptz{Time: time.Now().AddDate(0, 0, -daysAgo), Valid: true},
		Seconds:   3600, AvgWatts: 200, Kj: 720, Execution: 0.9, FtpWatts: user.FtpWatts,
		Samples: []byte("x"), Curve: curve, Xp: 100,
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}
	return id
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
		Ftp      int `json:"ftp"`
		Best20m  int `json:"best20m"`
		FtpAfter int `json:"ftpAfter"`
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

// SPEC: form shows 28 days after the rider's FIRST saved ride — not the
// oldest inside the year window, which after a long break was last week's.
func TestColdStartCountsFromTheFirstRide(t *testing.T) {
	mux, st, u := setup(t)
	addRide(t, st, u, 400, 240)
	addRide(t, st, u, 5, 230)
	status, body := get(t, mux, "alice")
	if status != http.StatusOK || body.Load == nil {
		t.Fatalf("progression: %d %+v", status, body.Load)
	}
	if body.Load.Building {
		t.Fatal("a rider with a ride 400 days ago is still 'building'")
	}
}

// The FTP a ramp test PRODUCED reaches the trend on the ramp's own ride
// (#1572). Everything else says nothing: the field is absent, not zero, so a
// chart cannot mistake an ordinary ride for a test that measured 0 W.
func TestTheFtpARampProducedReachesTheTrend(t *testing.T) {
	mux, st, u := setup(t)
	addRide(t, st, u, 10, 0)
	ramp := addRide(t, st, u, 3, 0)
	if _, err := st.Pool.Exec(t.Context(),
		"update rides set ftp_after_watts = 275 where id = $1", ramp); err != nil {
		t.Fatalf("stamp the ramp: %v", err)
	}

	code, body := get(t, mux, "alice")
	if code != http.StatusOK {
		t.Fatalf("got %d %+v", code, body)
	}
	if len(body.Rides) != 2 {
		t.Fatalf("expected 2 trend rows, got %d", len(body.Rides))
	}
	// Oldest first: the ordinary ride, then the ramp.
	if body.Rides[0].FtpAfter != 0 {
		t.Fatalf("an ordinary ride carries a produced FTP: %+v", body.Rides[0])
	}
	if body.Rides[1].FtpAfter != 275 {
		t.Fatalf("the ramp's produced FTP: got %d, want 275", body.Rides[1].FtpAfter)
	}
	// And the line does not move: the ramp was still SCORED against 250.
	if body.Rides[1].Ftp != 250 {
		t.Fatalf("ftp at ride time moved: %+v", body.Rides[1])
	}

	// Absent rather than zero on the wire, so `ftpAfter ?? 0` and a missing
	// key mean the same thing to the chart.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/progression", nil)
	req.Header.Set("X-Test-User", "alice")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var raw struct {
		Rides []map[string]any `json:"rides"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("raw body: %v", err)
	}
	if _, present := raw.Rides[0]["ftpAfter"]; present {
		t.Fatalf("an ordinary ride ships the key: %v", raw.Rides[0])
	}
	if _, present := raw.Rides[1]["ftpAfter"]; !present {
		t.Fatalf("the ramp does not ship the key: %v", raw.Rides[1])
	}
}
