package gifs

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeUsers resolves the X-Test-User header instead of a session cookie —
// same shape every other package's suite uses.
type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

func rider(t *testing.T) db.User {
	t.Helper()
	id, err := store.ParseUUID("11111111-1111-1111-1111-111111111111")
	if err != nil {
		t.Fatal(err)
	}
	return db.User{ID: id}
}

// tenorStub answers like Tenor v2 and records what was asked of it.
func tenorStub(t *testing.T, body string) (*httptest.Server, *url.Values) {
	t.Helper()
	var got url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Query()
		got.Set("path", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func newService(t *testing.T, upstream string) (*Service, *http.ServeMux) {
	t.Helper()
	svc := &Service{
		users:   &fakeUsers{byToken: map[string]db.User{"rider": rider(t)}},
		log:     slog.New(slog.DiscardHandler),
		key:     "test-key",
		apiBase: upstream,
		httpc:   &http.Client{Timeout: 5 * time.Second},
		now:     time.Now,
		recent:  map[string][]time.Time{},
	}
	mux := http.NewServeMux()
	svc.Register(mux)
	return svc, mux
}

func call(t *testing.T, mux *http.ServeMux, path, who string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

const twoResults = `{"results":[
  {"id":"a","content_description":"a cat on a bike","media_formats":{
     "gif":{"url":"https://media.tenor.com/aaa/cat.gif","dims":[400,300]},
     "tinygif":{"url":"https://media1.tenor.com/aaa/cat-small.gif","dims":[220,165]}}},
  {"id":"b","content_description":"sprint","media_formats":{
     "gif":{"url":"https://media.tenor.com/bbb/sprint.gif","dims":[400,300]}}}
],"next":"24"}`

func TestSearchMapsResultsAndAsksTenorCorrectly(t *testing.T) {
	upstream, asked := tenorStub(t, twoResults)
	_, mux := newService(t, upstream.URL)

	rec := call(t, mux, "/api/gifs?q=cat", "rider")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
	}
	var body searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 2 || body.Next != "24" {
		t.Fatalf("results = %+v, next = %q", body.Results, body.Next)
	}
	first := body.Results[0]
	if first.URL != "https://media.tenor.com/aaa/cat.gif" ||
		first.Preview != "https://media1.tenor.com/aaa/cat-small.gif" ||
		first.Alt != "a cat on a bike" || first.Width != 220 || first.Height != 165 {
		t.Fatalf("first tile = %+v", first)
	}
	// No tinygif: the preview falls back to the full GIF rather than a hole.
	if body.Results[1].Preview != "https://media.tenor.com/bbb/sprint.gif" {
		t.Fatalf("fallback preview = %q", body.Results[1].Preview)
	}
	if asked.Get("path") != "/search" || asked.Get("q") != "cat" ||
		asked.Get("contentfilter") != "high" || asked.Get("key") != "test-key" {
		t.Fatalf("asked tenor for %v", *asked)
	}
}

func TestEmptyQueryAsksForFeatured(t *testing.T) {
	upstream, asked := tenorStub(t, twoResults)
	_, mux := newService(t, upstream.URL)

	if rec := call(t, mux, "/api/gifs", "rider"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if asked.Get("path") != "/featured" || asked.Has("q") {
		t.Fatalf("asked tenor for %v", *asked)
	}
}

// A result the client would refuse to draw is dropped here, not sent onward
// as a broken tile — and never as a URL chat would post as bare text.
func TestUnrenderableResultsAreDropped(t *testing.T) {
	upstream, _ := tenorStub(t, `{"results":[
	  {"id":"http","media_formats":{"gif":{"url":"http://media.tenor.com/x/a.gif"}}},
	  {"id":"host","media_formats":{"gif":{"url":"https://media.tenor.com.evil.example/x/a.gif"}}},
	  {"id":"mp4","media_formats":{"gif":{"url":"https://media.tenor.com/x/a.mp4"}}},
	  {"id":"none","media_formats":{}},
	  {"id":"good","media_formats":{"gif":{"url":"https://media.tenor.com/x/a.gif"}}}
	]}`)
	_, mux := newService(t, upstream.URL)

	rec := call(t, mux, "/api/gifs?q=x", "rider")
	var body searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 1 || body.Results[0].ID != "good" {
		t.Fatalf("results = %+v", body.Results)
	}
}

// A bad preview does not cost the tile: it falls back to the full GIF.
func TestUnrenderablePreviewFallsBack(t *testing.T) {
	upstream, _ := tenorStub(t, `{"results":[{"id":"a","media_formats":{
	  "gif":{"url":"https://media.tenor.com/x/a.gif"},
	  "tinygif":{"url":"https://evil.example/x/a.gif"}}}]}`)
	_, mux := newService(t, upstream.URL)

	rec := call(t, mux, "/api/gifs?q=x", "rider")
	var body searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 1 || body.Results[0].Preview != "https://media.tenor.com/x/a.gif" {
		t.Fatalf("results = %+v", body.Results)
	}
}

func TestRefusals(t *testing.T) {
	upstream, _ := tenorStub(t, twoResults)
	_, mux := newService(t, upstream.URL)

	cases := []struct {
		name, path, who string
		want            int
	}{
		{"signed out", "/api/gifs?q=cat", "", http.StatusUnauthorized},
		{"query too long", "/api/gifs?q=" + url.QueryEscape(longQuery()), "rider", http.StatusBadRequest},
		{"cursor too long", "/api/gifs?pos=" + longQuery() + longQuery() + longQuery(), "rider", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rec := call(t, mux, tc.path, tc.who); rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.want, rec.Body)
			}
		})
	}
}

func longQuery() string {
	s := ""
	for range 101 {
		s += "a"
	}
	return s
}

// An upstream outage is "wait and retry", not "your input was wrong".
func TestUpstreamFailureIsRetryable(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer upstream.Close()
	_, mux := newService(t, upstream.URL)

	rec := call(t, mux, "/api/gifs?q=cat", "rider")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

// One rider must not be able to empty the key's quota.
func TestRateLimit(t *testing.T) {
	upstream, _ := tenorStub(t, twoResults)
	svc, mux := newService(t, upstream.URL)
	at := time.Now()
	svc.now = func() time.Time { return at }

	for i := range rateLimit {
		if rec := call(t, mux, "/api/gifs?q=cat", "rider"); rec.Code != http.StatusOK {
			t.Fatalf("call %d: status = %d", i, rec.Code)
		}
	}
	if rec := call(t, mux, "/api/gifs?q=cat", "rider"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("over the ceiling: status = %d, want 429", rec.Code)
	}
	// The window slides: a minute later the rider is welcome again.
	at = at.Add(rateWindow + time.Second)
	if rec := call(t, mux, "/api/gifs?q=cat", "rider"); rec.Code != http.StatusOK {
		t.Fatalf("after the window: status = %d", rec.Code)
	}
}

func TestNewWithoutKeyIsNil(t *testing.T) {
	t.Setenv("WATTROOM_TENOR_KEY", "")
	if svc := New(&fakeUsers{}, slog.New(slog.DiscardHandler)); svc != nil {
		t.Fatal("a keyless server should leave the route unmounted")
	}
}
