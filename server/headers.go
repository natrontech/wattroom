package main

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// cspShared is every directive the enforced and the report-only policy agree
// on (#1737, promoted from report-only after #1775 enforced the three a ride
// cannot break). They differ in exactly one directive, `img-src`, which each
// appends below — so the difference stays one line rather than two long strings
// drifting apart, which is the failure mode that would put a host in the policy
// nobody is watching.
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
//     (web/src/lib/room/youtube-api.ts) and the frame-src entry does not cover
//     a script; and blob: because a Worklet module is matched against
//     script-src rather than worker-src — the mic meter's AudioWorklet is added
//     from a blob: URL (web/src/lib/room/mic-level.ts). That last one was
//     settled by trying it both ways in a browser, not from the spec: without
//     blob: the module is refused with a bare AbortError and **no
//     securitypolicyviolation is reported at all**, so a report-only run could
//     never have named it. 'unsafe-inline' is for the theme block at
//     app.html:8 and stays until someone hashes it; while it stands, blob:
//     widens nothing that is not already open. No 'unsafe-eval' and no
//     'wasm-unsafe-eval': the production bundle carries no eval, no
//     `new Function` and no WebAssembly, livekit-client included.
//   - style-src — the bundle's stylesheet, plus 'unsafe-inline' for both the
//     <style> the theme block injects and every `style=` attribute Svelte
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
//     (web/src/lib/room/JukeboxDock.svelte); www.youtube.com is named beside it
//     because the IFrame API rewrites the frame's host when it falls back. The
//     locked RMF constraints make the official player the only one, so this
//     list cannot shrink.
//   - worker-src 'self' blob: — the ride ticker's Worker is a blob
//     (web/src/lib/workout/ticker.ts).
//   - frame-ancestors / base-uri / object-src — enforced since #1775.
//
// One thing this should not oversell: with a third-party script host the locked
// RMF constraints make unavoidable, plus the 'unsafe-inline' the theme block
// still needs, the enforced script-src is defence-in-depth and not an XSS
// boundary. Hashing the theme block is what would change that, and it is its
// own piece of work.
const cspShared = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline' blob: https://www.youtube.com; " +
	"style-src 'self' 'unsafe-inline'; " +
	"media-src 'self' blob:; font-src 'self' data:; " +
	"connect-src 'self' wss: https:; " +
	"frame-src https://www.youtube-nocookie.com https://www.youtube.com; " +
	"worker-src 'self' blob:; " +
	"frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

// enforcedCSP is what the browser applies. Everything in cspShared is enforced;
// `img-src` is deliberately looser here than in the policy below, and the
// reason is a rider's face (#2078).
//
// A rider who signed in with Google, GitHub or Strava has the picture that
// provider serves, stored as its absolute URL and drawn as a plain <img>
// (server/internal/auth/providers.go → identities.go, rendered by
// $lib/components/Avatar.svelte). Only a picture the rider uploaded themselves
// becomes same-origin, at /api/riders/{id}/avatar. So the host set is those
// three CDNs plus whatever a self-hoster's own OIDC provider uses: operator
// config, unbounded, and invisible to any sweep of the code because the URLs
// arrive from the database at runtime. Enforcing the host list below would
// blank the avatar of most riders on most deployments.
//
// `https:` is the honest floor instead. It still refuses http: and every other
// scheme an injected <img> would want as an exfiltration sink, and it leaves
// only the host open. The host list stays in reportOnlyCSP as the target, so a
// provider avatar is still reported, and the diff to close is one directive
// wide once WattRoom serves those pictures itself (#2078).
const enforcedCSP = cspShared + "; img-src 'self' data: blob: https:"

// reportOnlyCSP is where the app is headed: enforcedCSP with `img-src` narrowed
// to the hosts it knowingly loads pictures from — YouTube's thumbnail CDN for
// the deck (web/src/lib/room/jukebox-add.ts), and the Giphy and Tenor media
// hosts, because a picked or pasted GIF is drawn as a direct <img> at its own
// CDN by design (web/src/lib/chat/media.ts, server/internal/gifs). Both shard
// their hostnames (media0…mediaN, i, c), so the wildcard host-source is the
// only form that covers them. Chat link previews need nothing here: the unfurl
// proxy is already same-origin on purpose, so no rider's IP reaches a
// stranger's host (server/internal/unfurl).
//
// It reports rather than blocks only because of the avatars above. Closing
// #2078 promotes this directive and deletes this constant.
const reportOnlyCSP = cspShared +
	"; img-src 'self' data: blob: https://i.ytimg.com https://*.giphy.com https://*.tenor.com"

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
func secured(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", enforcedCSP)
		h.Set("Content-Security-Policy-Report-Only", reportOnlyCSP)
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
