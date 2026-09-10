package main

import (
	"compress/gzip"
	"crypto/tls"
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
	if got := rec.Header().Get("Content-Security-Policy"); got != enforcedCSP {
		t.Errorf("the shell's CSP = %q, want %q", got, enforcedCSP)
	}
}

// securedHeaders runs one request through secured() and hands back what the
// middleware wrote. overTLS mirrors a request that reached this binary over TLS,
// which in production it never does — Caddy terminates (ADR-0002).
func securedHeaders(t *testing.T, overTLS bool) http.Header {
	t.Helper()
	handler := secured(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequestWithContext(t.Context(), "GET", "/r/velvet", nil)
	if overTLS {
		req.TLS = &tls.ConnectionState{}
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec.Header()
}

// Every hardening header the middleware owns, asserted by value (#1609, #1737).
func TestSecuredSetsEveryHardeningHeader(t *testing.T) {
	h := securedHeaders(t, false)
	for header, want := range map[string]string{
		"Content-Security-Policy":   enforcedCSP,
		"X-Content-Type-Options":    "nosniff",
		"Referrer-Policy":           "strict-origin-when-cross-origin",
		"Strict-Transport-Security": "max-age=31536000",
		"Permissions-Policy":        permissionsPolicy,
	} {
		if got := h.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

// HSTS rides plain http too, and must: this binary never terminates TLS, so
// gating on the request's own transport would drop the header behind Caddy
// and leave production with none. A browser ignores it unless it arrived over
// a secure transport (RFC 6797 §8.1), which is what leaves `make dev-server`
// on http://localhost untouched. No includeSubDomains — a self-hoster's other
// subdomains are not this binary's to claim (#1737).
func TestHSTSRidesEveryResponseAndClaimsNoSubdomains(t *testing.T) {
	for _, overTLS := range []bool{false, true} {
		got := securedHeaders(t, overTLS).Get("Strict-Transport-Security")
		if got != "max-age=31536000" {
			t.Errorf("over TLS=%v: HSTS = %q, want max-age=31536000", overTLS, got)
		}
		if strings.Contains(strings.ToLower(got), "includesubdomains") {
			t.Errorf("over TLS=%v: HSTS claims subdomains: %q", overTLS, got)
		}
	}
}

// The Permissions-Policy grants exactly the three features the app calls and
// denies the rest (#1737). A wrong entry here is a rider who cannot pair a
// trainer or speak, so the whole policy is pinned entry by entry — including
// that nothing beyond these five is named.
func TestPermissionsPolicyGrantsOnlyWhatTheAppUses(t *testing.T) {
	want := map[string]string{
		"camera":      "(self)", // LiveKit video
		"microphone":  "(self)", // LiveKit voice
		"bluetooth":   "(self)", // the trainer and its sensors
		"geolocation": "()",     // never called
		"payment":     "()",     // never called
	}

	got := map[string]string{}
	for _, entry := range strings.Split(securedHeaders(t, false).Get("Permissions-Policy"), ",") {
		feature, allowlist, ok := strings.Cut(strings.TrimSpace(entry), "=")
		if !ok {
			t.Fatalf("entry %q is not feature=allowlist", entry)
		}
		// Structured fields let the last of two entries for one feature win,
		// so a second `camera=` appended by mistake would silently override
		// the first. That is the bug this test is for — name it.
		if _, dupe := got[feature]; dupe {
			t.Errorf("%s is named twice; the last entry silently wins", feature)
		}
		got[feature] = allowlist
	}

	if len(got) != len(want) {
		t.Errorf("policy names %d features, want %d: %v", len(got), len(want), got)
	}
	for feature, allowlist := range want {
		if got[feature] != allowlist {
			t.Errorf("%s = %q, want %q", feature, got[feature], allowlist)
		}
	}
}

// directives splits a CSP into name → source-list. The name is compared
// lowercase because CSP directive names are ASCII case-insensitive, and a
// policy that named one twice would let the FIRST win (CSP3 §4.2.1, the
// opposite of the Permissions-Policy rule above) — so a duplicate is called out
// here rather than silently folded.
func directives(t *testing.T, policy string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, entry := range strings.Split(policy, ";") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		name, sources, _ := strings.Cut(entry, " ")
		name = strings.ToLower(name)
		if _, dupe := out[name]; dupe {
			t.Errorf("%s is named twice; the FIRST entry silently wins", name)
		}
		out[name] = strings.TrimSpace(sources)
	}
	return out
}

// The enforced policy is the one a browser acts on, so every origin the app
// actually reaches for has to be in it — a host missing here is a white screen,
// or a feature that fails quietly into a handled error, for every rider
// (#1737). Each row names the fetch site it was read off, and every one of them
// was then watched in a real browser under this policy.
func TestEnforcedCSPNamesEveryOriginTheAppLoads(t *testing.T) {
	got := directives(t, securedHeaders(t, false).Get("Content-Security-Policy"))

	for _, tc := range []struct{ what, directive, sources string }{
		// The floor: anything not named below lands on same-origin.
		{"the fallback for every unnamed directive", "default-src", "'self'"},
		// web/src/lib/room/youtube-api.ts loads the IFrame API as a <script>
		// tag — the frame-src row does not cover a script. blob: is the mic
		// meter's AudioWorklet (web/src/lib/room/mic-level.ts): a worklet module
		// is matched against script-src, and refusing it reports NO violation,
		// so only trying it in a browser could establish that.
		{"the YouTube IFrame API script and the mic worklet", "script-src", "'self' 'unsafe-inline' blob: https://www.youtube.com"},
		// The theme block at app.html:8 injects a <style>, and Svelte renders
		// `style=` attributes, which fall back to here from style-src-attr.
		{"the theme block's stylesheet and every style= attribute", "style-src", "'self' 'unsafe-inline'"},
		// The closed host list, enforced since #2078 mirrored provider
		// sign-in pictures onto this origin: 'self' is every rider's face
		// (/api/riders/{id}/avatar) and every proxied link thumbnail, i.ytimg
		// the jukebox deck, giphy/tenor a picked or pasted GIF at its own CDN
		// (ADR-0032). No `https:`, so an injected <img> has nowhere to send a
		// rider's address.
		{"pictures, from the four hosts the app knowingly loads them from", "img-src", "'self' data: blob: https://i.ytimg.com https://*.giphy.com https://*.tenor.com"},
		// The audio pool streams from /api/tracks/{id}/audio; a pasted image
		// previews from a blob.
		{"the audio pool and a pasted image's preview", "media-src", "'self' blob:"},
		// Barlow and Chakra Petch ship through @fontsource, served by us.
		{"the two bundled typefaces", "font-src", "'self' data:"},
		// The app's own /ws is same-origin. wss: is LiveKit, whose URL is the
		// operator's; https: is oEmbed (ADR-0031), the update feed, and
		// livekit-client's own Cloud region lookup.
		{"the room socket, LiveKit and the oEmbed endpoints", "connect-src", "'self' wss: https:"},
		{"the player iframe", "frame-src", "https://www.youtube-nocookie.com https://www.youtube.com"},
		// The ride ticker's blob Worker (web/src/lib/workout/ticker.ts).
		{"the ride ticker's worker", "worker-src", "'self' blob:"},
		// Enforced since #1775.
		{"nothing may frame WattRoom", "frame-ancestors", "'none'"},
		{"no <base> may redirect a relative URL", "base-uri", "'none'"},
		{"no plugin loads", "object-src", "'none'"},
	} {
		if got[tc.directive] != tc.sources {
			t.Errorf("%s: %s = %q, want %q", tc.what, tc.directive, got[tc.directive], tc.sources)
		}
	}

	// A directive the app needs but nobody named does not go unrestricted: it
	// falls back to default-src 'self' and is blocked. So an addition here is a
	// deliberate act, and this count is what makes someone say so.
	if len(got) != 12 {
		t.Errorf("the enforced policy names %d directives, want 12: %v", len(got), got)
	}
}

// There is one policy now, and img-src is the reason there used to be two
// (#1737 → #2069 → #2078). What replaces the drift guard is the property the
// promotion depended on: no source in the enforced policy may name a host, or
// a scheme, wide enough to let a rider's picture come from somebody else's
// server again.
//
// A wildcard scheme source in img-src is what made the old policy honest but
// weak — `https:` allowed any host on the web, so an injected <img> could
// carry a rider's address anywhere. Losing that was the point.
func TestImgSrcNamesHostsAndNotSchemes(t *testing.T) {
	if _, reportOnly := securedHeaders(t, false)["Content-Security-Policy-Report-Only"]; reportOnly {
		t.Error("a report-only policy is back; it existed only while img-src could not be enforced (#2078)")
	}
	sources := strings.Fields(directives(t, enforcedCSP)["img-src"])
	if len(sources) == 0 {
		t.Fatal("img-src names nothing at all")
	}
	for _, source := range sources {
		// data: and blob: are the app's own bytes, in the document and in
		// memory — neither reaches a network. Any other bare scheme is "every
		// host that speaks it".
		if source == "data:" || source == "blob:" {
			continue
		}
		if !strings.Contains(source, "//") && strings.HasSuffix(source, ":") {
			t.Errorf("img-src names the scheme %q — that is every host on the internet, which is what #2078 closed", source)
		}
	}
}
