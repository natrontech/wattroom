package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"net/http"
	"path"
	"slices"
	"strings"

	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// enforcedCSP is the policy the browser applies — all of it, since #2078
// closed the one directive that could not be promoted (see img-src below).
// There is no report-only policy any more: a second header was worth carrying
// only while one directive was still waiting on a code change.
//
// Every directive was derived from what the app actually loads — the fetch
// sites, then a real browser under this exact policy — because an enforcing CSP
// that is wrong is a white screen for every rider. What each one is holding up:
//
//   - default-src 'self' — the floor, so a directive nobody thought to name
//     (manifest-src, prefetch-src, child-src …) falls back to same-origin
//     rather than to nothing. That makes an omission below a block rather than
//     a gap, which is why every directive the app needs is named explicitly.
//   - script-src — 'self' for the bundle; https://www.youtube.com because the
//     jukebox loads https://www.youtube.com/iframe_api as a <script> tag
//     (web/src/lib/channel/youtube-api.ts) and the frame-src entry does not cover
//     a script; and blob: because a Worklet module is matched against
//     script-src rather than worker-src — the mic meter's AudioWorklet is added
//     from a blob: URL (web/src/lib/channel/mic-level.ts). That last one was
//     settled by trying it both ways in a browser, not from the spec: without
//     blob: the module is refused with a bare AbortError and **no
//     securitypolicyviolation is reported at all**, so a report-only run could
//     never have named it. There is no 'unsafe-inline' (#2965): the build's
//     inline scripts — app.html's theme block, and SvelteKit's boot script in
//     the fallback and in every prerendered page, whose content changes with
//     every build — are allowed by hash, read off the embedded build at boot
//     (inlineScriptHashes), so an injected inline script runs nowhere. No
//     'unsafe-eval' and no
//     'wasm-unsafe-eval': the production bundle carries no eval, no
//     `new Function` and no WebAssembly, livekit-client included.
//   - style-src — the bundle's stylesheet, plus 'unsafe-inline' for the
//     <style> the theme block injects, app.html's own for the frame it holds
//     while the app loads (#2845), and every `style=` attribute Svelte
//     renders (style-src-attr falls back to here).
//   - media-src 'self' blob: — the audio pool streams from
//     /api/tracks/{id}/audio (web/src/lib/music/pool.ts) and a pasted image
//     previews from a blob. The cue engine synthesises rather than fetches, so
//     it asks for nothing.
//   - font-src 'self' data: — Barlow and Chakra Petch ship through @fontsource
//     and are served by this binary. Nothing reaches fonts.googleapis.com.
//   - connect-src 'self' wss: https: — wide on purpose, and not narrowable
//     here: LiveKit's URL is the operator's config rather than code, and
//     livekit-client additionally calls https://cloud-api.livekit.io for region
//     lookup on Cloud, so an allowlist built from WATTROOM_LIVEKIT_URL alone
//     would break voice for Cloud operators. Chat unfurls also reach YouTube's
//     and Spotify's oEmbed endpoints straight from the browser (ADR-0031), and
//     the desktop shell asks api.github.com for its update feed. What it does
//     buy is the scheme. The app's own /ws is same-origin, so 'self' carries
//     it; a cross-origin LiveKit on plain ws: would be blocked, which is right
//     — deploy/docker-compose.prod.yml uses wss://, and an https page cannot
//     open a ws:// socket anyway.
//   - frame-src — the jukebox player, which the dock pins to youtube-nocookie
//     (web/src/lib/channel/JukeboxDock.svelte); www.youtube.com is named beside it
//     because the IFrame API rewrites the frame's host when it falls back. The
//     locked RMF constraints make the official player the only one, so this
//     list cannot shrink.
//   - worker-src 'self' blob: — the ride ticker's Worker is a blob
//     (web/src/lib/workout/ticker.ts).
//   - frame-ancestors / base-uri / object-src — enforced since #1775.
//
// What it still cannot claim: the locked RMF constraints make a third-party
// script host unavoidable, so script-src trusts whatever www.youtube.com serves.
func enforcedCSP(scriptHashes []string) string {
	sources := append([]string{"'self'"}, scriptHashes...)
	sources = append(sources, "blob:", "https://www.youtube.com")
	return "default-src 'self'; script-src " + strings.Join(sources, " ") + "; " + cspAfterScripts
}

// cspAfterScripts is every directive after script-src, which alone depends on
// the build.
const cspAfterScripts = "style-src 'self' 'unsafe-inline'; " +
	"media-src 'self' blob:; font-src 'self' data:; " +
	"connect-src 'self' wss: https:; " +
	"frame-src https://www.youtube-nocookie.com https://www.youtube.com; " +
	"worker-src 'self' blob:; " +
	"frame-ancestors 'none'; base-uri 'none'; object-src 'none'; " +
	// img-src names the hosts the app knowingly loads pictures from, and
	// nothing else. It was `https:` — the scheme, any host — until #2078,
	// because a rider who signed in with Google, GitHub or Strava carried the
	// picture *that provider serves* as an absolute URL, so the host set was
	// those three CDNs plus whatever a self-hoster's own OIDC provider uses:
	// operator config, unbounded, and invisible to a sweep of the code
	// because the URLs arrived from the database at runtime. Now the picture
	// is copied onto this origin at sign-in (server/internal/avatars), 'self'
	// covers every rider's face, and the list is closed:
	//
	//   - i.ytimg.com — the jukebox deck's video thumbnails
	//     (web/src/lib/channel/jukebox-add.ts).
	//   - *.giphy.com, *.tenor.com — a picked or pasted GIF is drawn as a
	//     direct <img> at its own CDN by design (ADR-0032,
	//     web/src/lib/chat/media.ts, server/internal/gifs). Both shard their
	//     hostnames (media0…mediaN, i, c), so the wildcard host-source is the
	//     only form that covers them.
	//   - data: for the inline pictures the component gallery draws
	//     (web/src/routes/(app)/dev/components), blob: for the preview of an image
	//     a rider has pasted but not yet sent.
	//
	// Chat link previews and rider pictures need no host here on purpose:
	// both are proxied or stored, so no rider's address reaches a stranger's
	// server (server/internal/unfurl, server/internal/avatars).
	"img-src 'self' data: blob: https://i.ytimg.com https://*.giphy.com https://*.tenor.com"

// inlineScriptHashes is a CSP hash-source for every inline script the build's
// pages carry (#2965), read once at boot: the embedded build never changes
// under a running process. A script with a src is 'self' and has no text to
// hash, and a data block such as JSON-LD is never executed, so script-src has
// nothing to say about either. The tokenizer hands a script's text back raw,
// newlines normalised, which is the text a browser hashes.
func inlineScriptHashes(dist fs.FS) []string {
	var hashes []string
	_ = fs.WalkDir(dist, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || path.Ext(p) != ".html" {
			return nil
		}
		page, err := fs.ReadFile(dist, p)
		if err != nil {
			return nil
		}
		z := xhtml.NewTokenizer(bytes.NewReader(page))
		for {
			switch z.Next() {
			case xhtml.ErrorToken:
				return nil
			case xhtml.StartTagToken:
				if name, _ := z.TagName(); atom.Lookup(name) != atom.Script || !executableInline(z) {
					continue
				}
				if z.Next() != xhtml.TextToken {
					continue
				}
				sum := sha256.Sum256(z.Text())
				hashes = append(hashes, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
			}
		}
	})
	slices.Sort(hashes)
	return slices.Compact(hashes)
}

// executableInline reads the attributes of the <script> the tokenizer is on:
// its type is JavaScript, or it has none. A script with a src has no text, so
// the caller never gets as far as hashing one.
func executableInline(z *xhtml.Tokenizer) bool {
	for {
		key, val, more := z.TagAttr()
		if string(key) == "type" {
			t := strings.ToLower(strings.TrimSpace(string(val)))
			if t != "" && t != "module" && !strings.Contains(t, "javascript") && !strings.Contains(t, "ecmascript") {
				return false
			}
		}
		if !more {
			return true
		}
	}
}

// permissionsPolicy pins the three powerful features the app actually asks
// for and denies the rest (#1737). WattRoom needs Web Bluetooth (the trainer
// and its sensors — web/src/lib/ble/), the microphone (LiveKit voice) and the
// camera (LiveKit video); all three already default to an allowlist of `self`,
// so naming them here pins today's behaviour rather than granting anything —
// what it buys is that a future embed or third-party frame cannot inherit
// them. geolocation and payment are denied outright: nothing in the app calls
// either, and a policy that lists only what it grants is the one worth
// auditing. A user agent that does not know a feature skips that entry and
// keeps the rest (Permissions Policy §5.2), so `bluetooth` — Chromium-only,
// like Web Bluetooth itself — costs Firefox and Safari nothing.
const permissionsPolicy = "camera=(self), microphone=(self), bluetooth=(self), geolocation=(), payment=()"

// secured is the second line of defence the app document never had (#1609):
// nothing may frame WattRoom, a response's type is what it says, a rider's
// URL does not ride a referrer to another site in full, and a browser that
// has seen the site over TLS stays on TLS (#1737 — HSTS is ignored over
// plain http, so a laptop's dev server is untouched; no includeSubDomains,
// a self-hoster's other subdomains are not this binary's to decide). HSTS
// rides every response rather than only the TLS ones on purpose: this binary
// never terminates TLS (Caddy does, ADR-0002), so a request's own transport
// is always plain http here and gating on it would drop the header in
// production. RFC 6797 §8.1 is what keeps dev clean — a browser must ignore
// the header unless it arrived over a secure transport.
func secured(next http.Handler, csp string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Strict-Transport-Security", "max-age=31536000")
		h.Set("Permissions-Policy", permissionsPolicy)
		next.ServeHTTP(w, r)
	})
}

// apiNotFound is the API's own 404 for a path no handler owns (#1604).
func apiNotFound(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteError(w, http.StatusNotFound, "not_found", "No such API route.")
}

// metricsMoved answers the address /metrics used to be served at (#1738). A
// scrape left pointing here otherwise reads as "this server has no metrics",
// which is a worse half-hour than a sentence saying where they went.
func metricsMoved(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteError(w, http.StatusNotFound, "not_found",
		"Metrics are not served on this port. See deploy/README.md.")
}
