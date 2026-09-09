package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/natrontech/wattroom/server/internal/og"
	"github.com/natrontech/wattroom/server/internal/store"
)

func discardLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestVersionHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	versionHandler()(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/version", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if got["commit"] == "" {
		t.Fatal("commit is empty — want a revision or the dev fallback")
	}
}

// Test binaries carry no vcs stamp, so this exercises exactly the Docker
// path: no stamp in the binary, sha delivered by env.
func TestVersionHandlerEnvFallback(t *testing.T) {
	t.Setenv("WATTROOM_BUILD_SHA", "abcdef1234567890")
	rec := httptest.NewRecorder()
	versionHandler()(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/version", nil))

	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if got["commit"] != "abcdef1" {
		t.Fatalf("commit = %q, want %q", got["commit"], "abcdef1")
	}
}

// No database configured is solo-ride mode: the server really can serve, and
// the maintenance page must not sit on a spinner waiting for a Postgres that
// was never meant to exist.
func TestHealthzWithoutStore(t *testing.T) {
	rec := httptest.NewRecorder()
	healthzHandler(nil, discardLog())(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/healthz", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != "ok" {
		t.Fatalf("body = %q, want %q", got, "ok")
	}
}

// The regression this endpoint exists to prevent: it answered "ok" while the
// database was gone, so nothing downstream could tell a healthy deploy from a
// broken one.
func TestHealthzUnreachableDatabase(t *testing.T) {
	pool, err := pgxpool.New(t.Context(), "postgres://nobody:nobody@127.0.0.1:1/nope")
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	rec := httptest.NewRecorder()
	healthzHandler(&store.Store{Pool: pool}, discardLog())(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/healthz", nil))

	if rec.Code != 503 {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

// The updater compares this field against the tag it asked for, so a build
// that is not a release must not report one.
func TestVersionHandlerReportsTag(t *testing.T) {
	rec := httptest.NewRecorder()
	versionHandler()(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/version", nil))
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if got["version"] != "dev" {
		t.Fatalf("version = %q, want %q for an untagged build", got["version"], "dev")
	}

	t.Setenv("WATTROOM_VERSION", "v0.4.0")
	rec = httptest.NewRecorder()
	versionHandler()(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/version", nil))
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if got["version"] != "v0.4.0" {
		t.Fatalf("version = %q, want %q", got["version"], "v0.4.0")
	}
}

// The hashed build is the only thing that may be cached forever. index.html
// names the current hashes, so caching it would pin a rider to the build they
// first loaded and hide every deploy from them — the failure this test exists
// to prevent, since nothing else in the response would look wrong.
// Hashed assets are pinned for a year; everything else revalidates. The pair
// is the point: pinning the chunks is only safe while the document that names
// them is re-checked, and shipping the first half without the second froze
// returning riders on the previous release (#966).
func TestSPACachesHashedAssetsOnly(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":                   {Data: []byte("<html></html>")},
		"_app/immutable/chunks/abc.js": {Data: []byte("console.log(1)")},
		"favicon.png":                  {Data: []byte("png")},
	}
	handler := serveSPA(dist, og.New("https://wattroom.test", nil, discardLog()))

	const immutable = "public, max-age=31536000, immutable"
	const revalidate = "no-cache"
	for _, tc := range []struct {
		path string
		want string
	}{
		{"/_app/immutable/chunks/abc.js", immutable},
		{"/index.html", revalidate},
		{"/", revalidate},
		{"/r/velvet-hammer", revalidate}, // SPA fallback: index.html again
		{"/favicon.png", revalidate},     // from the build, but not hashed
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), "GET", tc.path, nil))
		if rec.Code != 200 {
			t.Errorf("%s: status = %d, want 200", tc.path, rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != tc.want {
			t.Errorf("%s: Cache-Control = %q, want %q", tc.path, got, tc.want)
		}
	}
}

// Every non-hashed file and the shell carry a validator (audit 2026-09-09):
// "no-cache" with nothing to revalidate against re-downloaded the 114 KB
// changelog on every visit to /home, and the shell on every cold load.
func TestSPARevalidatesWithAnETag(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":   {Data: []byte("<html><head></head></html>")},
		"changelog.md": {Data: []byte("# 2026.09.73\n- something")},
	}
	handler := serveSPA(dist, og.New("https://wattroom.test", nil, discardLog()))
	for _, path := range []string{"/changelog.md", "/", "/r/velvet-hammer"} {
		first := httptest.NewRecorder()
		handler.ServeHTTP(first, httptest.NewRequestWithContext(t.Context(), "GET", path, nil))
		tag := first.Header().Get("ETag")
		if first.Code != 200 || tag == "" {
			t.Fatalf("%s: status %d, ETag %q — want 200 with a validator", path, first.Code, tag)
		}
		again := httptest.NewRequestWithContext(t.Context(), "GET", path, nil)
		again.Header.Set("If-None-Match", tag)
		second := httptest.NewRecorder()
		handler.ServeHTTP(second, again)
		if second.Code != http.StatusNotModified {
			t.Errorf("%s: a matching If-None-Match answered %d, want 304", path, second.Code)
		}
		if second.Body.Len() != 0 {
			t.Errorf("%s: a 304 carried %d bytes of body", path, second.Body.Len())
		}
	}
}

// The binary compresses its own text (audit 2026-09-09): the eager shell is
// 2.75× smaller gzipped, and leaving that to an edge in another repo meant
// nothing here could tell when it was missing.
func TestSPACompressesTextForClientsThatAskForIt(t *testing.T) {
	script := strings.Repeat("console.log('a long enough line to compress');\n", 40)
	dist := fstest.MapFS{
		"index.html":                   {Data: []byte("<html><head></head><body>shell</body></html>")},
		"_app/immutable/chunks/abc.js": {Data: []byte(script)},
		"favicon.png":                  {Data: []byte("not really a png")},
	}
	handler := serveSPA(dist, og.New("https://wattroom.test", nil, discardLog()))
	get := func(path, accept string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), "GET", path, nil)
		if accept != "" {
			req.Header.Set("Accept-Encoding", accept)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	// Text, asked for gzip: encoded, marked, and the bytes round-trip.
	for _, path := range []string{"/_app/immutable/chunks/abc.js", "/", "/r/velvet-hammer"} {
		rec := get(path, "gzip, deflate, br")
		if rec.Code != 200 || rec.Header().Get("Content-Encoding") != "gzip" || rec.Header().Get("Vary") != "Accept-Encoding" {
			t.Fatalf("%s: %d %q vary=%q, want 200 gzip", path, rec.Code, rec.Header().Get("Content-Encoding"), rec.Header().Get("Vary"))
		}
		zr, err := gzip.NewReader(rec.Body)
		if err != nil {
			t.Fatalf("%s: body is not gzip: %v", path, err)
		}
		plain, _ := io.ReadAll(zr)
		if path == "/_app/immutable/chunks/abc.js" && string(plain) != script {
			t.Errorf("%s: the script did not round-trip", path)
		}
		if rec.Header().Get("Content-Length") != "" {
			t.Errorf("%s: a compressed response kept the raw Content-Length", path)
		}
	}
	// Not asked for: raw. A picture: raw. A 304: no encoding claimed.
	if rec := get("/_app/immutable/chunks/abc.js", ""); rec.Header().Get("Content-Encoding") != "" || rec.Body.String() != script {
		t.Errorf("a client that did not ask got %q", rec.Header().Get("Content-Encoding"))
	}
	if rec := get("/favicon.png", "gzip"); rec.Header().Get("Content-Encoding") != "" {
		t.Errorf("a png was compressed")
	}
	tag := get("/", "gzip").Header().Get("ETag")
	req := httptest.NewRequestWithContext(t.Context(), "GET", "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("If-None-Match", tag)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified || rec.Header().Get("Content-Encoding") != "" {
		t.Errorf("a 304 answered %d with encoding %q", rec.Code, rec.Header().Get("Content-Encoding"))
	}
}

// An unknown API path is the API's 404, never the shell with a 200 (#1604);
// and every response carries the hardening headers (#1609).
func TestUnknownAPIRouteAndSecurityHeaders(t *testing.T) {
	dist := fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", apiNotFound)
	mux.Handle("/", serveSPA(dist, og.New("https://wattroom.test", nil, discardLog())))
	handler := secured(mux)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/nope", nil))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Header().Get("Content-Type"), "json") || !strings.Contains(rec.Body.String(), `"not_found"`) {
		t.Fatalf("/api/nope: %d %s %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/r/velvet", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("the shell: %d", rec.Code)
	}
	for header, want := range map[string]string{
		"Content-Security-Policy": "frame-ancestors 'none'",
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "strict-origin-when-cross-origin",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}
