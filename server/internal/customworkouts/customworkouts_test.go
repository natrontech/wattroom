package customworkouts

import (
	"context"
	"encoding/json"
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

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.User(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

func setup(t *testing.T) (*http.ServeMux, *store.Store) {
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
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return mux, st
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

const valid = `{"workout":{"name":"My 2x8","steps":[{"type":"steady","seconds":480,"target":0.95},{"type":"steady","seconds":240,"target":0.5}]}}`

func TestWorkoutCRUD(t *testing.T) {
	mux, _ := setup(t)

	// Unauthenticated → 401 on every verb.
	if status, _ := call(t, mux, "", http.MethodGet, "/api/workouts", ""); status != http.StatusUnauthorized {
		t.Fatalf("anon list: %d", status)
	}

	// Create, list, update, delete — the whole shelf lifecycle.
	status, body := call(t, mux, "alice", http.MethodPost, "/api/workouts", valid)
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, body)
	}
	id, _ := body["id"].(string)

	status, body = call(t, mux, "alice", http.MethodGet, "/api/workouts", "")
	list, _ := body["workouts"].([]any)
	if status != http.StatusOK || len(list) != 1 {
		t.Fatalf("list: %d %v", status, body)
	}

	updated := strings.Replace(valid, "My 2x8", "My 2x9", 1)
	if status, body = call(t, mux, "alice", http.MethodPut, "/api/workouts/"+id, updated); status != http.StatusOK {
		t.Fatalf("update: %d %v", status, body)
	}

	// Someone else's workout is a 404, not a 403 — no probing which ids exist.
	if status, _ = call(t, mux, "bob", http.MethodPut, "/api/workouts/"+id, valid); status != http.StatusNotFound {
		t.Fatalf("bob update: %d", status)
	}
	if status, _ = call(t, mux, "bob", http.MethodDelete, "/api/workouts/"+id, ""); status != http.StatusNotFound {
		t.Fatalf("bob delete: %d", status)
	}
	if status, _ = call(t, mux, "alice", http.MethodDelete, "/api/workouts/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	status, body = call(t, mux, "alice", http.MethodGet, "/api/workouts", "")
	remaining, _ := body["workouts"].([]any)
	if status != http.StatusOK || len(remaining) != 0 {
		t.Fatalf("list after delete: %d %v", status, body)
	}
}

func TestWorkoutValidation(t *testing.T) {
	mux, _ := setup(t)
	for name, tc := range map[string]struct {
		body  string
		field string
	}{
		"no name":     {`{"workout":{"steps":[{"type":"steady","seconds":60,"target":0.5}]}}`, "name"},
		"no steps":    {`{"workout":{"name":"Empty","steps":[]}}`, "workout"},
		"not json":    {`{"workout":"nope"}`, "workout"},
		"day too big": {`{"workout":{"name":"Forever","steps":[{"type":"steady","seconds":90000,"target":0.5}]}}`, "workout"},
	} {
		status, body := call(t, mux, "alice", http.MethodPost, "/api/workouts", tc.body)
		if status != http.StatusBadRequest || body["field"] != tc.field {
			t.Fatalf("%s: %d %v", name, status, body)
		}
	}
}
