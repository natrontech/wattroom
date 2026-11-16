package plans

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

var today = time.Date(2026, 11, 16, 9, 0, 0, 0, time.UTC)

const def = `{"name":"Easy spin","steps":[{"type":"steady","seconds":2700,"target":0.55}]}`

type fixture struct {
	mux     *http.ServeMux
	st      *store.Store
	users   *testx.Users
	workout map[string]string // rider → their one shelf workout id
}

func setup(t *testing.T) fixture {
	t.Helper()
	st := storetest.Open(t)
	f := fixture{st: st, users: &testx.Users{ByToken: map[string]db.User{}}, workout: map[string]string{}}
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
		f.users.ByToken[name] = u
		w, err := st.Queries.CreateWorkout(t.Context(), db.CreateWorkoutParams{OwnerID: u.ID, Name: "Easy spin", Author: name, Definition: []byte(def)})
		if err != nil {
			t.Fatal(err)
		}
		f.workout[name] = store.UUIDString(w.ID)
	}
	svc := New(st, f.users, slog.New(slog.DiscardHandler))
	svc.now = func() time.Time { return today }
	f.mux = http.NewServeMux()
	svc.Register(f.mux)
	return f
}

func (f fixture) call(t *testing.T, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	f.mux.ServeHTTP(w, req)
	var out map[string]any
	_ = json.NewDecoder(w.Body).Decode(&out)
	return w.Code, out
}

func (f fixture) days(t *testing.T, user string) []string {
	t.Helper()
	code, body := f.call(t, user, "GET", "/api/plan?from=2026-11-01&to=2027-01-31", "")
	if code != http.StatusOK {
		t.Fatalf("list: %d %v", code, body)
	}
	plans, _ := body["plans"].([]any)
	var out []string
	for _, p := range plans {
		row, _ := p.(map[string]any)
		day, _ := row["day"].(string)
		out = append(out, day)
	}
	return out
}

// A rider plans, moves and unplans their own shelf workouts; another rider
// sees none of it and can touch none of it.
func TestPlanIsTheRidersAlone(t *testing.T) {
	f := setup(t)
	code, made := f.call(t, "alice", "POST", "/api/plan", `{"workoutId":"`+f.workout["alice"]+`","day":"2026-11-19"}`)
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, made)
	}
	id, _ := made["id"].(string)
	if got := f.days(t, "alice"); len(got) != 1 || got[0] != "2026-11-19" {
		t.Fatalf("alice's plan: %v", got)
	}
	if got := f.days(t, "bob"); len(got) != 0 {
		t.Fatalf("bob sees alice's plan: %v", got)
	}

	for _, tc := range []struct{ name, method, path, body string }{
		{"bob plans alice's workout", "POST", "/api/plan", `{"workoutId":"` + f.workout["alice"] + `","day":"2026-11-19"}`},
		{"bob moves alice's plan", "PUT", "/api/plan/" + id, `{"day":"2026-11-20"}`},
		{"bob unplans alice's plan", "DELETE", "/api/plan/" + id, ""},
	} {
		if code, body := f.call(t, "bob", tc.method, tc.path, tc.body); code != http.StatusNotFound {
			t.Errorf("%s: %d %v, want 404", tc.name, code, body)
		}
	}

	if code, _ := f.call(t, "alice", "PUT", "/api/plan/"+id, `{"day":"2026-11-20"}`); code != http.StatusNoContent {
		t.Fatalf("move: %d", code)
	}
	if got := f.days(t, "alice"); len(got) != 1 || got[0] != "2026-11-20" {
		t.Fatalf("after move: %v", got)
	}
	if code, _ := f.call(t, "alice", "DELETE", "/api/plan/"+id, ""); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if got := f.days(t, "alice"); len(got) != 0 {
		t.Fatalf("after delete: %v", got)
	}
}

// Deleting the workout takes its planned days with it: a plan never names
// a workout the shelf no longer holds.
func TestDeletingTheWorkoutUnplansIt(t *testing.T) {
	f := setup(t)
	if code, body := f.call(t, "alice", "POST", "/api/plan", `{"workoutId":"`+f.workout["alice"]+`","day":"2026-11-19"}`); code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, body)
	}
	id, _ := store.ParseUUID(f.workout["alice"])
	if _, err := f.st.Queries.DeleteWorkout(t.Context(), db.DeleteWorkoutParams{ID: id, OwnerID: f.users.ByToken["alice"].ID}); err != nil {
		t.Fatal(err)
	}
	if got := f.days(t, "alice"); len(got) != 0 {
		t.Fatalf("a deleted workout is still planned: %v", got)
	}
}

func TestPlanBounds(t *testing.T) {
	f := setup(t)
	w := f.workout["alice"]
	for _, tc := range []struct {
		name, method, path, body string
		want                     int
	}{
		{"yesterday, a zone ahead", "POST", "/api/plan", `{"workoutId":"` + w + `","day":"2026-11-15"}`, http.StatusCreated},
		{"two days ago", "POST", "/api/plan", `{"workoutId":"` + w + `","day":"2026-11-14"}`, http.StatusBadRequest},
		{"three months out", "POST", "/api/plan", `{"workoutId":"` + w + `","day":"2027-02-16"}`, http.StatusCreated},
		{"past three months", "POST", "/api/plan", `{"workoutId":"` + w + `","day":"2027-02-18"}`, http.StatusBadRequest},
		{"not a date", "POST", "/api/plan", `{"workoutId":"` + w + `","day":"Thursday"}`, http.StatusBadRequest},
		{"not an id", "POST", "/api/plan", `{"workoutId":"nope","day":"2026-11-19"}`, http.StatusNotFound},
		{"a list backwards", "GET", "/api/plan?from=2026-11-20&to=2026-11-19", "", http.StatusBadRequest},
		{"a list too long", "GET", "/api/plan?from=2026-01-01&to=2026-12-31", "", http.StatusBadRequest},
		{"a list with no dates", "GET", "/api/plan", "", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if code, body := f.call(t, "alice", tc.method, tc.path, tc.body); code != tc.want {
				t.Errorf("%d %v, want %d", code, body, tc.want)
			}
		})
	}
}

// The ceiling counts what is still ahead: a full plan refuses with 429 and
// says what frees a place.
func TestPlanCeiling(t *testing.T) {
	f := setup(t)
	alice := f.users.ByToken["alice"].ID
	if _, err := f.st.Pool.Exec(t.Context(),
		`insert into personal_plans (user_id, workout_id, day)
		 select $1, $2, date '2026-11-20' from generate_series(1, $3)`,
		alice, f.workout["alice"], maxUpcoming); err != nil {
		t.Fatal(err)
	}
	code, body := f.call(t, "alice", "POST", "/api/plan", `{"workoutId":"`+f.workout["alice"]+`","day":"2026-11-21"}`)
	if code != http.StatusTooManyRequests || !strings.Contains(fmt.Sprint(body["message"]), "Remove one") {
		t.Fatalf("101st plan: %d %v", code, body)
	}
}
