package gifs

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
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

func rider(t *testing.T, id string) db.User {
	t.Helper()
	uuid, err := store.ParseUUID(id)
	if err != nil {
		t.Fatal(err)
	}
	return db.User{ID: uuid}
}

// giphyStub answers like Giphy v1, records what was asked of it, and counts
// how often — the cache tests turn on that count.
type giphyStub struct {
	server *httptest.Server
	asked  url.Values
	calls  atomic.Int32
}

func newStub(t *testing.T, body string) *giphyStub {
	t.Helper()
	stub := &giphyStub{}
	stub.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stub.calls.Add(1)
		stub.asked = r.URL.Query()
		stub.asked.Set("path", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(stub.server.Close)
	return stub
}

func newService(t *testing.T, upstream string) (*Service, *http.ServeMux) {
	t.Helper()
	svc := &Service{
		users: &fakeUsers{byToken: map[string]db.User{
			"rider": rider(t, "11111111-1111-1111-1111-111111111111"),
			"other": rider(t, "22222222-2222-2222-2222-222222222222"),
		}},
		log:     slog.New(slog.DiscardHandler),
		key:     "test-key",
		apiBase: upstream,
		httpc:   &http.Client{Timeout: 5 * time.Second},
		now:     time.Now,
		recent:  map[string][]time.Time{},
		cache:   map[string]cached{},
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

func decode(t *testing.T, rec *httptest.ResponseRecorder) searchResponse {
	t.Helper()
	var body searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body, err)
	}
	return body
}

const twoResults = `{"data":[
  {"id":"a","alt_text":"a cat on a bike","images":{
     "downsized":{"url":"https://media0.giphy.com/media/aaa/giphy.gif","width":"400","height":"300"},
     "fixed_width":{"url":"https://media1.giphy.com/media/aaa/200w.gif","width":"200","height":"150"}}},
  {"id":"b","title":"sprint","images":{
     "downsized":{"url":"https://media2.giphy.com/media/bbb/giphy.gif","width":"400","height":"300"}}}
],"pagination":{"count":2,"offset":0}}`

func TestSearchMapsResultsAndAsksGiphyCorrectly(t *testing.T) {
	stub := newStub(t, twoResults)
	_, mux := newService(t, stub.server.URL)

	rec := call(t, mux, "/api/gifs?q=cat", "rider")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
	}
	body := decode(t, rec)
	if len(body.Results) != 2 {
		t.Fatalf("results = %+v", body.Results)
	}
	// The sent URL is downsized; the grid draws fixed_width, and the tile's
	// dimensions are the preview's, not the sent one's.
	first := body.Results[0]
	if first.URL != "https://media0.giphy.com/media/aaa/giphy.gif" ||
		first.Preview != "https://media1.giphy.com/media/aaa/200w.gif" ||
		first.Alt != "a cat on a bike" || first.Width != 200 || first.Height != 150 {
		t.Fatalf("first tile = %+v", first)
	}
	// No fixed_width: the preview falls back to what gets sent, and the alt
	// text falls back from alt_text to title.
	if body.Results[1].Preview != "https://media2.giphy.com/media/bbb/giphy.gif" ||
		body.Results[1].Alt != "sprint" {
		t.Fatalf("second tile = %+v", body.Results[1])
	}
	// A short page is the last one.
	if body.Next != "" {
		t.Fatalf("next = %q, want none on a short page", body.Next)
	}
	if stub.asked.Get("path") != "/search" || stub.asked.Get("q") != "cat" ||
		stub.asked.Get("rating") != "g" || stub.asked.Get("api_key") != "test-key" {
		t.Fatalf("asked giphy for %v", stub.asked)
	}
}

func TestEmptyQueryAsksForTrending(t *testing.T) {
	stub := newStub(t, twoResults)
	_, mux := newService(t, stub.server.URL)

	if rec := call(t, mux, "/api/gifs", "rider"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if stub.asked.Get("path") != "/trending" || stub.asked.Has("q") {
		t.Fatalf("asked giphy for %v", stub.asked)
	}
}

// A full page offers the next one, and the offset is what comes back.
func TestFullPageOffersTheNextOne(t *testing.T) {
	stub := newStub(t, `{"data":[],"pagination":{"count":24,"offset":0}}`)
	_, mux := newService(t, stub.server.URL)

	if body := decode(t, call(t, mux, "/api/gifs?q=cat", "rider")); body.Next != "24" {
		t.Fatalf("next = %q, want 24", body.Next)
	}
	if body := decode(t, call(t, mux, "/api/gifs?q=cat&pos=24", "rider")); body.Next != "48" {
		t.Fatalf("next = %q, want 48", body.Next)
	}
	if stub.asked.Get("offset") != "24" {
		t.Fatalf("asked giphy for offset %q", stub.asked.Get("offset"))
	}
}

// A result the client would refuse to draw is dropped here, not sent onward
// as a broken tile — and never as a URL chat would post as bare text.
func TestUnrenderableResultsAreDropped(t *testing.T) {
	stub := newStub(t, `{"data":[
	  {"id":"http","images":{"downsized":{"url":"http://media0.giphy.com/x/a.gif"}}},
	  {"id":"host","images":{"downsized":{"url":"https://media0.giphy.com.evil.example/x/a.gif"}}},
	  {"id":"mp4","images":{"downsized":{"url":"https://media0.giphy.com/x/a.mp4"}}},
	  {"id":"none","images":{}},
	  {"id":"good","images":{"downsized":{"url":"https://media0.giphy.com/x/a.gif"}}}
	],"pagination":{"count":5,"offset":0}}`)
	_, mux := newService(t, stub.server.URL)

	body := decode(t, call(t, mux, "/api/gifs?q=x", "rider"))
	if len(body.Results) != 1 || body.Results[0].ID != "good" {
		t.Fatalf("results = %+v", body.Results)
	}
}

// An unusable rendition is skipped for the next name in the list, not for the
// whole tile.
func TestRenditionsFallThrough(t *testing.T) {
	stub := newStub(t, `{"data":[{"id":"a","images":{
	  "downsized":{"url":"https://evil.example/x/a.gif","width":"9","height":"9"},
	  "fixed_width":{"url":"https://media0.giphy.com/x/200w.gif","width":"200","height":"100"}}}],
	  "pagination":{"count":1,"offset":0}}`)
	_, mux := newService(t, stub.server.URL)

	body := decode(t, call(t, mux, "/api/gifs?q=x", "rider"))
	if len(body.Results) != 1 {
		t.Fatalf("results = %+v", body.Results)
	}
	if got := body.Results[0]; got.URL != "https://media0.giphy.com/x/200w.gif" ||
		got.Preview != got.URL || got.Width != 200 {
		t.Fatalf("tile = %+v", got)
	}
}

func TestRefusals(t *testing.T) {
	stub := newStub(t, twoResults)
	_, mux := newService(t, stub.server.URL)

	cases := []struct {
		name, path, who string
		want            int
	}{
		{"signed out", "/api/gifs?q=cat", "", http.StatusUnauthorized},
		{"query too long", "/api/gifs?q=" + url.QueryEscape(strings.Repeat("a", maxQueryRunes+1)), "rider", http.StatusBadRequest},
		{"cursor not a number", "/api/gifs?pos=abc", "rider", http.StatusBadRequest},
		{"cursor negative", "/api/gifs?pos=-1", "rider", http.StatusBadRequest},
		{"cursor past giphy's ceiling", "/api/gifs?pos=5000", "rider", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rec := call(t, mux, tc.path, tc.who); rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.want, rec.Body)
			}
		})
	}
}

// An upstream outage is "wait and retry", not "your input was wrong".
func TestUpstreamFailureIsRetryable(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer upstream.Close()
	_, mux := newService(t, upstream.URL)

	if rec := call(t, mux, "/api/gifs?q=cat", "rider"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

// The whole point of the cache: the same page, asked for again, does not
// spend the key's budget a second time.
func TestCacheServesRepeatsWithoutSpending(t *testing.T) {
	stub := newStub(t, twoResults)
	svc, mux := newService(t, stub.server.URL)
	at := time.Now()
	svc.now = func() time.Time { return at }

	for range 5 {
		if rec := call(t, mux, "/api/gifs", "rider"); rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
	}
	// Another rider opening their picker rides the same cached trending page.
	if rec := call(t, mux, "/api/gifs", "other"); rec.Code != http.StatusOK {
		t.Fatalf("other rider: status = %d", rec.Code)
	}
	if got := stub.calls.Load(); got != 1 {
		t.Fatalf("upstream calls = %d, want 1", got)
	}
	if spent := len(svc.upstream); spent != 1 {
		t.Fatalf("charged %d calls against the key, want 1", spent)
	}

	// Past the TTL it is fetched again.
	at = at.Add(cacheTTL + time.Second)
	if rec := call(t, mux, "/api/gifs", "rider"); rec.Code != http.StatusOK {
		t.Fatalf("after the TTL: status = %d", rec.Code)
	}
	if got := stub.calls.Load(); got != 2 {
		t.Fatalf("upstream calls = %d, want 2", got)
	}
}

// One rider must not be the reason the shared key ran out.
func TestPerAccountCeiling(t *testing.T) {
	stub := newStub(t, twoResults)
	svc, mux := newService(t, stub.server.URL)
	at := time.Now()
	svc.now = func() time.Time { return at }

	// Distinct queries, so nothing is answered from the cache.
	for i := range rateLimit {
		path := "/api/gifs?q=" + strings.Repeat("a", i+1)
		if rec := call(t, mux, path, "rider"); rec.Code != http.StatusOK {
			t.Fatalf("call %d: status = %d", i, rec.Code)
		}
	}
	if rec := call(t, mux, "/api/gifs?q=zzz", "rider"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("over the ceiling: status = %d, want 429", rec.Code)
	}
	// Someone else is unaffected — the ceiling is per account.
	if rec := call(t, mux, "/api/gifs?q=yyy", "other"); rec.Code != http.StatusOK {
		t.Fatalf("other rider: status = %d, want 200", rec.Code)
	}
	// The window slides.
	at = at.Add(rateWindow + time.Second)
	if rec := call(t, mux, "/api/gifs?q=xxx", "rider"); rec.Code != http.StatusOK {
		t.Fatalf("after the window: status = %d", rec.Code)
	}
}

// The key's own hourly budget refuses everyone once it is spent, and says so
// as a server condition rather than blaming the rider's input.
func TestKeyBudgetCeiling(t *testing.T) {
	stub := newStub(t, twoResults)
	svc, mux := newService(t, stub.server.URL)
	at := time.Now()
	svc.now = func() time.Time { return at }

	// Spread across accounts so the per-account ceiling never bites first.
	for i := range keyLimit {
		who := "rider"
		if i%2 == 0 {
			who = "other"
		}
		at = at.Add(rateWindow + time.Second)
		path := "/api/gifs?q=" + strings.Repeat("a", i+1)
		if rec := call(t, mux, path, who); rec.Code != http.StatusOK {
			t.Fatalf("call %d: status = %d (%s)", i, rec.Code, rec.Body)
		}
	}
	rec := call(t, mux, "/api/gifs?q=zzz", "rider")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("over the key budget: status = %d, want 503", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "rate_limited") {
		t.Fatalf("body = %s", rec.Body)
	}
	// A page still inside the TTL is free even when the budget is gone —
	// this is the last query the loop made, so it is the freshest entry.
	last := "/api/gifs?q=" + strings.Repeat("a", keyLimit)
	if rec := call(t, mux, last, "rider"); rec.Code != http.StatusOK {
		t.Fatalf("cached page while over budget: status = %d", rec.Code)
	}
}

// A refused call is not charged: being over one ceiling must not consume the
// budget the other ceiling protects.
func TestRefusalCostsNothing(t *testing.T) {
	stub := newStub(t, twoResults)
	svc, mux := newService(t, stub.server.URL)
	at := time.Now()
	svc.now = func() time.Time { return at }

	for i := range rateLimit {
		call(t, mux, "/api/gifs?q="+strings.Repeat("a", i+1), "rider")
	}
	spent := len(svc.upstream)
	for range 5 {
		call(t, mux, "/api/gifs?q=zzz", "rider")
	}
	if now := len(svc.upstream); now != spent {
		t.Fatalf("refused calls charged the key: %d → %d", spent, now)
	}
}

func TestNewWithoutKeyIsNil(t *testing.T) {
	t.Setenv("WATTROOM_GIPHY_KEY", "")
	if svc := New(&fakeUsers{}, slog.New(slog.DiscardHandler)); svc != nil {
		t.Fatal("a keyless server should leave the route unmounted")
	}
}
