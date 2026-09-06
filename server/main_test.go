package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
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
func TestSPACachesHashedAssetsOnly(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":                   {Data: []byte("<html></html>")},
		"_app/immutable/chunks/abc.js": {Data: []byte("console.log(1)")},
		"favicon.png":                  {Data: []byte("png")},
	}
	handler := serveSPA(dist, og.New("https://wattroom.test", nil, discardLog()))

	const immutable = "public, max-age=31536000, immutable"
	for _, tc := range []struct {
		path string
		want string
	}{
		{"/_app/immutable/chunks/abc.js", immutable},
		{"/index.html", ""},
		{"/", ""},
		{"/r/velvet-hammer", ""}, // SPA fallback: index.html under another name
		{"/favicon.png", ""},     // served from the build, but not content-hashed
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
