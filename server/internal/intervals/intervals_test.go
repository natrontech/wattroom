package intervals

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A hand-written planned workout (AGENTS.md: no real payload in a fixture).
const zwo = `<workout_file><name>Tempo</name><workout>` +
	`<SteadyState Duration="600" Power="0.75"/></workout></workout_file>`

// users signs in whoever the X-Rider header names; none is signed out.
type users struct{}

func (users) RequireUser(w http.ResponseWriter, r *http.Request, msg string) (db.User, bool) {
	name := r.Header.Get("X-Rider")
	if name == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", msg)
		return db.User{}, false
	}
	var id pgtype.UUID
	copy(id.Bytes[:], name)
	id.Valid = true
	return db.User{ID: id, DisplayName: name}, true
}

// fakeIntervals is intervals.icu as far as the pull reaches it: the token
// exchange and the events read, each checking what the pull sends.
type fakeIntervals struct {
	t      *testing.T
	events string
	status int
	asked  url.Values
}

func (f *fakeIntervals) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/oauth/token":
		if err := r.ParseForm(); err != nil {
			f.t.Fatal(err)
		}
		if r.Form.Get("client_id") != "client" || r.Form.Get("client_secret") != "secret" || r.Form.Get("code") != "the-code" {
			http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"token_type":"Bearer","access_token":"the-token","scope":"CALENDAR:READ","athlete":{"id":"1","name":"Test"}}`)
	case "/api/v1/athlete/0/events":
		if r.Header.Get("Authorization") != "Bearer the-token" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		f.asked = r.URL.Query()
		if f.status != 0 {
			w.WriteHeader(f.status)
			return
		}
		_, _ = io.WriteString(w, f.events)
	default:
		http.NotFound(w, r)
	}
}

func setup(t *testing.T, configured bool) (*http.ServeMux, *fakeIntervals, *Service) {
	t.Helper()
	fake := &fakeIntervals{t: t}
	upstream := httptest.NewServer(fake)
	t.Cleanup(upstream.Close)
	id, secret := "", ""
	if configured {
		id, secret = "client", "secret"
	}
	s := newService(users{}, slog.New(slog.DiscardHandler), "https://wattroom.test", upstream.URL, id, secret)
	s.now = func() time.Time { return time.Date(2026, 9, 30, 8, 0, 0, 0, time.UTC) }
	mux := http.NewServeMux()
	s.Register(mux)
	return mux, fake, s
}

func get(mux http.Handler, target, rider string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if rider != "" {
		req.Header.Set("X-Rider", rider)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// start begins a pull and returns the state cookie intervals.icu is sent with.
func start(t *testing.T, mux http.Handler, rider string) *http.Cookie {
	t.Helper()
	rec := get(mux, "/api/intervals/start", rider)
	if rec.Code != http.StatusFound {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	to, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if got := to.Query().Get("scope"); got != "CALENDAR:READ" {
		t.Errorf("scope %q: the pull reads the calendar and nothing else", got)
	}
	if got := to.Query().Get("redirect_uri"); got != "https://wattroom.test/api/intervals/callback" {
		t.Errorf("redirect_uri %q", got)
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == stateCookie {
			if c.Value != to.Query().Get("state") {
				t.Fatalf("state cookie %q does not match the state sent %q", c.Value, to.Query().Get("state"))
			}
			return c
		}
	}
	t.Fatal("start set no state cookie")
	return nil
}

func landing(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code != http.StatusFound {
		t.Fatalf("callback: %d %s", rec.Code, rec.Body)
	}
	where := rec.Header().Get("Location")
	if !strings.HasPrefix(where, importPage) {
		t.Fatalf("callback lands on %q, not the import page", where)
	}
	return strings.TrimPrefix(where, importPage)
}

func TestPullReadsTheWeekOnceAndKeepsNoToken(t *testing.T) {
	mux, fake, s := setup(t, true)
	b64 := base64.StdEncoding.EncodeToString([]byte(zwo))
	fake.events = `[
		{"id":1,"category":"WORKOUT","name":"Tempo","start_date_local":"2026-10-01T00:00:00","workout_file_base64":"` + b64 + `"},
		{"id":2,"category":"WORKOUT","name":"A note with no file","start_date_local":"2026-10-02T00:00:00"}
	]`
	state := start(t, mux, "ana")
	id := landing(t, get(mux, "/api/intervals/callback?code=the-code&state="+state.Value, "ana", state))

	// The week, planned workouts, as .zwo — never activities.
	for key, want := range map[string]string{"category": "WORKOUT", "ext": "zwo", "oldest": "2026-09-30", "newest": "2026-10-06"} {
		if got := fake.asked.Get(key); got != want {
			t.Errorf("events %s = %q, want %q", key, got, want)
		}
	}

	rec := get(mux, "/api/intervals/pulls/"+id, "ana")
	if rec.Code != http.StatusOK {
		t.Fatalf("pull: %d %s", rec.Code, rec.Body)
	}
	var got struct {
		Workouts []Planned `json:"workouts"`
		Skipped  int       `json:"skipped"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Workouts) != 1 || got.Workouts[0].Zwo != zwo || got.Workouts[0].Date != "2026-10-01" || got.Workouts[0].Name != "Tempo" {
		t.Errorf("workouts = %+v", got.Workouts)
	}
	if got.Skipped != 1 {
		t.Errorf("skipped = %d: the event with no file is counted, not dropped silently", got.Skipped)
	}
	// Once: the second read finds nothing.
	if rec := get(mux, "/api/intervals/pulls/"+id, "ana"); rec.Code != http.StatusNotFound {
		t.Errorf("second read: %d", rec.Code)
	}
	// And nothing kept the token: the pull holds workouts only.
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.pulls {
		for _, w := range p.workouts {
			if strings.Contains(w.Zwo+w.Name, "the-token") {
				t.Error("a pull carries the token")
			}
		}
	}
}

func TestPullIsTheRidersOwn(t *testing.T) {
	mux, fake, _ := setup(t, true)
	fake.events = `[]`
	state := start(t, mux, "ana")
	id := landing(t, get(mux, "/api/intervals/callback?code=the-code&state="+state.Value, "ana", state))
	if rec := get(mux, "/api/intervals/pulls/"+id, "ben"); rec.Code != http.StatusNotFound {
		t.Errorf("another rider read the pull: %d", rec.Code)
	}
	// Ben's attempt did not spend Ana's pull.
	rec := get(mux, "/api/intervals/pulls/"+id, "ana")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"workouts":[]`) {
		t.Errorf("ana's pull: %d %s", rec.Code, rec.Body)
	}
}

func TestCallbackLandsEveryOutcomeOnTheImportPage(t *testing.T) {
	cases := []struct {
		name   string
		query  string
		cookie bool
		status int
		want   string
	}{
		{"a state this browser never started", "code=the-code&state=forged", true, 0, "expired"},
		{"no state cookie at all", "code=the-code&state=x", false, 0, "expired"},
		{"the rider said no", "error=access_denied", true, 0, "denied"},
		{"a code intervals.icu refuses", "code=wrong", true, 0, "failed"},
		{"intervals.icu failing the read", "code=the-code", true, http.StatusInternalServerError, "failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mux, fake, _ := setup(t, true)
			fake.status = tc.status
			state := start(t, mux, "ana")
			query := tc.query
			if !strings.Contains(query, "state=") {
				query += "&state=" + state.Value
			}
			var cookies []*http.Cookie
			if tc.cookie {
				cookies = append(cookies, state)
			}
			if got := landing(t, get(mux, "/api/intervals/callback?"+query, "ana", cookies...)); got != tc.want {
				t.Errorf("landed on %q, want %q", got, tc.want)
			}
		})
	}
}

func TestWithoutAClientThePullIsNotOffered(t *testing.T) {
	mux, _, _ := setup(t, false)
	rec := get(mux, "/api/intervals", "")
	if !strings.Contains(rec.Body.String(), `"available":false`) {
		t.Errorf("capability: %s", rec.Body)
	}
	for _, path := range []string{"/api/intervals/start", "/api/intervals/callback?code=x&state=y"} {
		if rec := get(mux, path, "ana"); rec.Code != http.StatusNotFound {
			t.Errorf("%s without a client: %d", path, rec.Code)
		}
	}
	mux, _, _ = setup(t, true)
	if rec := get(mux, "/api/intervals", ""); !strings.Contains(rec.Body.String(), `"available":true`) {
		t.Errorf("capability with a client: %s", rec.Body)
	}
}

func TestPullNeedsASignedInRider(t *testing.T) {
	mux, _, _ := setup(t, true)
	for _, path := range []string{"/api/intervals/start", "/api/intervals/callback?code=x&state=y", "/api/intervals/pulls/x"} {
		if rec := get(mux, path, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s signed out: %d", path, rec.Code)
		}
	}
}

func TestAnExpiredPullIsGone(t *testing.T) {
	mux, fake, s := setup(t, true)
	fake.events = `[]`
	state := start(t, mux, "ana")
	id := landing(t, get(mux, "/api/intervals/callback?code=the-code&state="+state.Value, "ana", state))
	later := s.now().Add(pullTTL + time.Second)
	s.now = func() time.Time { return later }
	if rec := get(mux, "/api/intervals/pulls/"+id, "ana"); rec.Code != http.StatusNotFound {
		t.Errorf("an expired pull: %d", rec.Code)
	}
}
