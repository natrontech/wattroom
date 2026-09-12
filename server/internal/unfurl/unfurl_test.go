package unfurl

import (
	"encoding/json"
	"errors"
	"github.com/natrontech/wattroom/server/internal/testx"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

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
	users := &testx.Users{ByToken: map[string]db.User{"kim": {ID: id, DisplayName: "kim"}}}
	svc := New(users, slog.New(slog.DiscardHandler))
	svc.out.client = upstream.Client() // the guard has its own tests; this is the handler's
	svc.out.client.Timeout = fetchTimeout
	// Off by default: a test that means to measure the ration turns it on, so
	// no other test's 204 can quietly be the ration's rather than the page's.
	svc.burst = 0
	// httptest picks a random high port; the port policy has its own test.
	svc.out.ports = nil
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

// One rider re-reading one link costs the site one request. Not one per
// instance any more — the cache is keyed on (rider, url) since #1739.
func TestUnfurlCachesSoOneRidersLinkCostsTheSiteOneRequest(t *testing.T) {
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
	users, ok := svc.users.(*testx.Users)
	if !ok {
		t.Fatal("setup handed back a service with somebody else's user source")
	}
	users.ByToken["ada"] = db.User{ID: other, DisplayName: "ada"}
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

// The security test for #1739. The cache is consulted before the ration, so
// an entry another rider paid for would answer for free — and a free answer
// is a yes/no on whether somebody else on the instance pasted that link
// inside the TTL. Negatives carry the same tell: a page with no metadata is
// cached too, so the question works on links that never draw a card.
//
// Keyed on (rider, url) the question cannot be asked, and a regression shows
// up twice below: ada's ask would not reach the site, and it would not cost
// ada a token.
func TestTheCacheIsNotACrossRiderOracle(t *testing.T) {
	hits := map[string]int{}
	svc, mux, upstream := setup(t, func(w http.ResponseWriter, r *http.Request) {
		hits[r.URL.Path]++
		w.Header().Set("Content-Type", "text/html")
		if r.URL.Path == "/kim-read-this" {
			_, _ = io.WriteString(w, samplePage)
			return
		}
		_, _ = io.WriteString(w, "<html><body>nothing to say</body></html>")
	})
	other, err := store.ParseUUID("22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatal(err)
	}
	users, ok := svc.users.(*testx.Users)
	if !ok {
		t.Fatal("setup handed back a service with somebody else's user source")
	}
	users.ByToken["ada"] = db.User{ID: other, DisplayName: "ada"}
	// Two asks each, never refilled: enough for both links, and nothing
	// spare, so a free answer is visible as a token ada still has.
	svc.burst, svc.refill = 2, 0

	links := []struct {
		name, path string
		want       int
	}{
		{"a link that draws a card", "/kim-read-this", http.StatusOK},
		{"a link that draws nothing", "/kim-read-nothing", http.StatusNoContent},
	}
	for _, l := range links {
		if code := get(t, mux, "kim", ask("/api/unfurl", upstream.URL+l.path)).Code; code != l.want {
			t.Fatalf("kim, %s: %d, want %d", l.name, code, l.want)
		}
	}
	for _, l := range links {
		t.Run(l.name, func(t *testing.T) {
			if code := get(t, mux, "ada", ask("/api/unfurl", upstream.URL+l.path)).Code; code != l.want {
				t.Fatalf("ada: %d, want %d", code, l.want)
			}
			if hits[l.path] != 2 {
				t.Fatalf("the site was asked %d times for %s: ada was served from kim's cache entry, "+
					"which tells ada that somebody else pasted it", hits[l.path], l.path)
			}
		})
	}
	// The other half of the tell: a cross-rider hit is free, so it would
	// leave ada's ration untouched and this third ask would go through.
	if code := get(t, mux, "ada", ask("/api/unfurl", upstream.URL+"/ada-third")).Code; code != http.StatusTooManyRequests {
		t.Fatalf("ada's third ask: %d, want 429 — the first two did not cost ada anything", code)
	}
}

// Per-rider keys multiply the entries a set of links can occupy, so the
// ceiling has to count entries (#1739). It does, and it is the same ceiling
// as before: what per-rider keying spends is hit rate, not memory.
func TestTheCacheCeilingCountsEntriesNotLinks(t *testing.T) {
	svc, _, _ := setup(t, func(http.ResponseWriter, *http.Request) {
		t.Error("the ceiling is a property of the map, not of the network")
	})
	for rider := range 8 {
		for link := range maxCacheKeys {
			svc.remember(cacheKey{
				rider: "rider-" + strconv.Itoa(rider),
				url:   "https://example.test/l" + strconv.Itoa(link),
			}, Card{Title: "a ride worth reading about"}, true)
			if n := len(svc.cache); n > maxCacheKeys {
				t.Fatalf("cache holds %d entries, ceiling is %d", n, maxCacheKeys)
			}
		}
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

	svc := New(&testx.Users{ByToken: map[string]db.User{}}, slog.New(slog.DiscardHandler))
	if _, ok := svc.fetch(t.Context(), upstream.URL+"/page"); ok {
		t.Fatal("the guarded client fetched a page from 127.0.0.1")
	}
}

// Fetcher.Image is the read whose bytes get stored and then served from our
// own origin (a rider's sign-in picture, server/internal/avatars), so what it
// refuses matters more than what it accepts: a document that calls itself an
// image, a body over the cap, a host that answers with anything but 200.
func TestImageTakesTheTypeFromTheBytesAndCapsTheBody(t *testing.T) {
	big := make([]byte, 64)
	copy(big, "\x89PNG\r\n\x1a\n")
	svc, _, upstream := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/face.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nrest-of-a-picture"))
		case "/liar.png":
			// A provider's URL ends in .png and the header agrees; the bytes
			// are a document. Served from our origin it would be a stored
			// XSS, so the bytes decide.
			w.Header().Set("Content-Type", "image/png")
			_, _ = io.WriteString(w, "<html><script>alert(1)</script></html>")
		case "/huge.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(big)
		case "/gone.png":
			w.WriteHeader(http.StatusNotFound)
		}
	})

	data, mime, err := svc.out.Image(t.Context(), upstream.URL+"/face.png", 1<<20)
	if err != nil || mime != "image/png" || string(data) != "\x89PNG\r\n\x1a\nrest-of-a-picture" {
		t.Fatalf("a picture: %q %q %v", data, mime, err)
	}
	// Exactly at the cap is a picture, not a refusal.
	if _, _, err := svc.out.Image(t.Context(), upstream.URL+"/huge.png", int64(len(big))); err != nil {
		t.Fatalf("a body exactly at the cap was refused: %v", err)
	}
	for _, tc := range []struct {
		what string
		path string
		max  int64
		want error
	}{
		{"a document wearing an image's Content-Type", "/liar.png", 1 << 20, errNotImage},
		{"one byte over the cap", "/huge.png", int64(len(big)) - 1, errTooBig},
		{"a host that has no such picture", "/gone.png", 1 << 20, errNotFetched},
	} {
		if _, _, err := svc.out.Image(t.Context(), upstream.URL+tc.path, tc.max); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", tc.what, err, tc.want)
		}
	}
}
