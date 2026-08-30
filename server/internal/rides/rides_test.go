package rides

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

func setup(t *testing.T) *http.ServeMux {
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

	users := &fakeUsers{byToken: map[string]db.User{}}
	u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "alice", FtpWatts: 250, WeightKg: 70,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	users.byToken["alice"] = u
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return mux
}

func call(t *testing.T, mux *http.ServeMux, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

func rideBody(seconds, watts int) string {
	samples := make([]string, seconds)
	for i := range samples {
		samples[i] = fmt.Sprintf(`{"watts":%d,"cadence":90}`, watts)
	}
	return fmt.Sprintf(
		`{"workoutName":"Openers","workoutJson":"{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":%d,\"target\":0.8}]}","startedAt":%q,"samples":[%s]}`,
		seconds, time.Now().Add(-time.Hour).Format(time.RFC3339), strings.Join(samples, ","))
}

func TestSoloRideSaveAndList(t *testing.T) {
	mux := setup(t)

	if status, _ := call(t, mux, "", http.MethodPost, "/api/rides", rideBody(120, 200)); status != http.StatusUnauthorized {
		t.Fatalf("anon: %d", status)
	}

	// 120 s at 200 W against 0.8×250 = 200 W target: execution 1.0, 24 kJ.
	status, body := call(t, mux, "alice", http.MethodPost, "/api/rides", rideBody(120, 200))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, body)
	}
	kj, _ := body["kj"].(float64)
	execution, _ := body["execution"].(float64)
	if kj != 24 || execution < 0.99 {
		t.Fatalf("scoring: %v", body)
	}
	if body["room"] != nil && body["room"] != false {
		t.Fatalf("solo ride marked as room ride: %v", body)
	}

	status, body = call(t, mux, "alice", http.MethodGet, "/api/rides", "")
	rides, _ := body["rides"].([]any)
	if status != http.StatusOK || len(rides) != 1 {
		t.Fatalf("list: %d %v", status, body)
	}

	// Under a minute is a misclick, same rule the room saver uses.
	if status, body = call(t, mux, "alice", http.MethodPost, "/api/rides", rideBody(30, 200)); status != http.StatusBadRequest || body["field"] != "samples" {
		t.Fatalf("short ride: %d %v", status, body)
	}
	// Out-of-range watts bounce.
	bad := strings.Replace(rideBody(60, 200), `"watts":200`, `"watts":9000`, 1)
	if status, body = call(t, mux, "alice", http.MethodPost, "/api/rides", bad); status != http.StatusBadRequest || body["field"] != "samples" {
		t.Fatalf("bad watts: %d %v", status, body)
	}
}
