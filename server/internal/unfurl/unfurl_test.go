package unfurl

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeUsers is the sign-in gate: the X-Test-User header is the session.
type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, msg string) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", msg)
		return db.User{}, false
	}
	return u, true
}

// origin is an upstream site under the test's control, reached through a
// transport that skips the dialer — the guard has its own tests, and these
// are about what the handler does with what comes back.
func setup(t *testing.T, handler http.HandlerFunc) (*Service, *http.ServeMux, *httptest.Server) {
	t.Helper()
	upstream := httptest.NewServer(handler)
	t.Cleanup(upstream.Close)

	id, err := store.ParseUUID("11111111-1111-1111-1111-111111111111")
	if err != nil {
		t.Fatal(err)
	}
	users := &fakeUsers{byToken: map[string]db.User{"kim": {ID: id, DisplayName: "kim"}}}
	svc := New(users, slog.New(slog.DiscardHandler))
	svc.client = upstream.Client() // the guard has its own tests; this is the handler's
	svc.client.Timeout = fetchTimeout
	// Off by default: a test that means to measure the ration turns it on, so
	// no other test's 204 can quietly be the ration's rather than the page's.
	svc.burst = 0
	// httptest picks a random high port; the port policy has its own test.
	svc.ports = nil
	mux := http.NewServeMux()
	svc.Register(mux)
	return svc, mux, upstream
}

// ask builds one request. The URL under test is a query value, so it is
// escaped as one — "not a url at all" is a thing a rider can type.
func ask(endpoint, target string) string {
	return endpoint + "?" + url.Values{"url": {target}}.Encode()
}

func get(t *testing.T, mux *http.ServeMux, user, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

const samplePage = `<html><head>
	<meta property="og:title" content="A ride worth reading about">
	<meta property="og:description" content="Two hundred words on cadence.">
</head><body>x</body></html>`

func TestUnfurlHappyPathAndItsBoundary(t *testing.T) {
	_, mux, upstream := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/page":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.WriteString(w, samplePage)
		case "/pdf":
			w.Header().Set("Content-Type", "application/pdf")
			_, _ = io.WriteString(w, "%PDF-1.4 not a web page")
		case "/plain":
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "<html><body>nothing to say</body></html>")
		case "/gone":
			w.WriteHeader(http.StatusNotFound)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	if code := get(t, mux, "", ask("/api/unfurl", upstream.URL+"/page")).Code; code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", code)
	}
	for _, bad := range []string{"", "file:///etc/passwd", "javascript:alert(1)", "not a url at all", "://"} {
		w := get(t, mux, "kim", ask("/api/unfurl", bad))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("url=%q: %d, want 400", bad, w.Code)
		}
	}

	w := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/page"))
	if w.Code != http.StatusOK {
		t.Fatalf("happy path: %d %s", w.Code, w.Body)
	}
	var card Card
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Title != "A ride worth reading about" {
		t.Fatalf("card: %+v", card)
	}

	// Everything that is not a page with metadata is the same answer: no
	// card, no error for the rider to read.
	for _, path := range []string{"/pdf", "/plain", "/gone"} {
		w := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+path))
		if w.Code != http.StatusNoContent {
			t.Fatalf("%s: %d, want 204", path, w.Code)
		}
	}
}

func TestUnfurlCachesSoOneLinkCostsTheSiteOneRequest(t *testing.T) {
	var hits int
	_, mux, upstream := setup(t, func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, samplePage)
	})
	for i := 0; i < 5; i++ {
		if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/page")).Code; code != http.StatusOK {
			t.Fatalf("ask %d: %d", i, code)
		}
	}
	if hits != 1 {
		t.Fatalf("the site was asked %d times for one link", hits)
	}

	// A fragment is the reader's anchor, not a different page.
	if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/page#section")).Code; code != http.StatusOK {
		t.Fatal("fragment variant refused")
	}
	if hits != 1 {
		t.Fatalf("a #fragment cost the site another request (%d)", hits)
	}
}

func TestUnfurlRationsOneRider(t *testing.T) {
	svc, mux, upstream := setup(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, samplePage)
	})
	svc.burst, svc.refill = 1, 0 // one ask, never refilled
	// Distinct URLs, so the cache cannot answer and the ration must.
	if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/a")).Code; code != http.StatusOK {
		t.Fatalf("first ask: %d", code)
	}
	// 429, so the client knows to ask again rather than remembering a "no".
	if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/b")).Code; code != http.StatusTooManyRequests {
		t.Fatalf("second ask past the ration: %d, want 429", code)
	}
}

func TestTheRationIsABucketSoAScreenfulOfLinksGoesThrough(t *testing.T) {
	// The shape that matters: opening a busy channel asks for every distinct
	// link on the screen at once. A fixed gap between asks would refuse most
	// of them, and the rider would see a wall of bare URLs for no reason.
	var hits int
	svc, mux, upstream := setup(t, func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, samplePage)
	})
	svc.burst, svc.refill = riderBurst, riderRefill
	clock := time.Now()
	svc.now = func() time.Time { return clock }

	for i := range riderBurst {
		path := "/l" + strconv.Itoa(i)
		if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+path)).Code; code != http.StatusOK {
			t.Fatalf("link %d of a screenful: %d", i, code)
		}
	}
	if hits != riderBurst {
		t.Fatalf("%d of %d links were fetched", hits, riderBurst)
	}
	// One past the burst, on a clock that has not moved: refused.
	if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/over")).Code; code != http.StatusTooManyRequests {
		t.Fatalf("past the burst: %d, want 429", code)
	}
	// And it refills with time rather than needing a new session.
	clock = clock.Add(time.Second)
	if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/later")).Code; code != http.StatusOK {
		t.Fatalf("after a second of refill: %d", code)
	}
}

func TestOneRidersRationIsNotAnothersLimit(t *testing.T) {
	svc, mux, upstream := setup(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, samplePage)
	})
	other, err := store.ParseUUID("22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatal(err)
	}
	users, ok := svc.users.(*fakeUsers)
	if !ok {
		t.Fatal("setup handed back a service with somebody else's user source")
	}
	users.byToken["ada"] = db.User{ID: other, DisplayName: "ada"}
	svc.burst, svc.refill = 1, 0

	if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/a")).Code; code != http.StatusOK {
		t.Fatalf("kim's one ask: %d", code)
	}
	if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/b")).Code; code != http.StatusTooManyRequests {
		t.Fatalf("kim past their ration: %d", code)
	}
	// A rider who has spent nothing is not made to wait for one who has.
	if code := get(t, mux, "ada", ask("/api/unfurl", upstream.URL+"/c")).Code; code != http.StatusOK {
		t.Fatalf("ada paid for kim's asks: %d", code)
	}
}

func TestUnfurlStopsReadingAtTheByteCap(t *testing.T) {
	// The metadata is in the head; a host that never stops sending must not
	// be able to make the server hold its output.
	_, mux, upstream := setup(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, `<html><head><meta property="og:title" content="early">`)
		padding := strings.Repeat("<span>filler</span>", 1024)
		for written := 0; written < maxHTMLBytes*3; written += len(padding) {
			if _, err := io.WriteString(w, padding); err != nil {
				return
			}
		}
	})
	w := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+"/huge"))
	if w.Code != http.StatusOK {
		t.Fatalf("capped read: %d", w.Code)
	}
	var card Card
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Title != "early" {
		t.Fatalf("card: %+v", card)
	}
}

func TestImageProxyServesPicturesAndNothingElse(t *testing.T) {
	_, mux, upstream := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/thumb.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\npretend"))
		case "/page.html":
			// The proxy is not a second unfurl: HTML must not come back
			// through it, whatever the URL looks like.
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "<script>alert(1)</script>")
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	if code := get(t, mux, "", ask("/api/unfurl/image", upstream.URL+"/thumb.png")).Code; code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", code)
	}
	w := get(t, mux, "kim", ask("/api/unfurl/image", upstream.URL+"/thumb.png"))
	if w.Code != http.StatusOK {
		t.Fatalf("thumbnail: %d", w.Code)
	}
	if got := w.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type: %q", got)
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("a stranger's bytes served without nosniff")
	}

	// The refusals, each against its own service so nothing about one
	// assertion can be what makes the next one pass.
	for _, bad := range []string{"/page.html", "/drawing.svg", "/missing"} {
		_, mux, upstream := setup(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/page.html":
				w.Header().Set("Content-Type", "text/html")
				_, _ = io.WriteString(w, "<b>x</b>")
			case "/drawing.svg":
				// A picture by content type and a document in fact: an SVG
				// served from our origin carries script into it.
				w.Header().Set("Content-Type", "image/svg+xml")
				_, _ = io.WriteString(w, `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
			default:
				w.WriteHeader(http.StatusNotFound)
			}
		})
		if code := get(t, mux, "kim", ask("/api/unfurl/image", upstream.URL+bad)).Code; code != http.StatusNotFound {
			t.Fatalf("%s came back as %d, want 404", bad, code)
		}
	}
	if code := get(t, mux, "kim", ask("/api/unfurl/image", "file:///etc/passwd")).Code; code != http.StatusBadRequest {
		t.Fatalf("file scheme: %d", code)
	}
}

// The guard, end to end: the real client must refuse a server on loopback,
// which is exactly the address an SSRF is aimed at. Everything above swaps
// the client out; this is the one that keeps it.
func TestTheRealClientWillNotFetchFromLoopback(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, samplePage)
	}))
	defer upstream.Close()

	svc := New(&fakeUsers{byToken: map[string]db.User{}}, slog.New(slog.DiscardHandler))
	if _, ok := svc.fetch(t.Context(), upstream.URL+"/page"); ok {
		t.Fatal("the guarded client fetched a page from 127.0.0.1")
	}
}
