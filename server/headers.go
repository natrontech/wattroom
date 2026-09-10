package main

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// The policy enforced today (#1609, #1737): nothing may frame WattRoom, no
// <base> may redirect its relative URLs, and no plugin loads. Every other
// directive is in reportOnlyCSP until a ride has run under it.
const enforcedCSP = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

// reportOnlyCSP is the policy the app is expected to satisfy (#1737),
// shipped report-only so a violation is a console line, never a broken
// ride: the theme block in app.html is inline, the player is an iframe on
// youtube-nocookie, LiveKit is a wss: origin of the operator's choosing, a
// chat image is a same-origin blob, and the deck's thumbnails come from
// ytimg. Promote a directive to enforcedCSP only after a room with a
// video, voice and a chat image has run clean under it.
//
// Two host lists here are load-bearing and were missing, which would have
// made the promotion break the app rather than tighten it:
//   - www.youtube.com in script-src, because the player fetches
//     https://www.youtube.com/iframe_api as a <script> tag
//     (web/src/lib/room/youtube-api.ts) — the frame-src entry does not cover
//     it, and without it the jukebox never gets a YT.Player.
//   - the Giphy and Tenor media hosts in img-src, because a picked or pasted
//     GIF is drawn as a direct <img> at its own CDN by design
//     (web/src/lib/chat/media.ts, server/internal/gifs). Their hostnames are
//     sharded (media0…mediaN, i, c), so the wildcard host-source is the only
//     form that covers them.
//
// Open question the ride has to answer: the mic meter's AudioWorklet is added
// from a blob: URL (web/src/lib/room/mic-level.ts) and worklet modules may be
// matched against script-src rather than worker-src. If the report names it,
// script-src needs blob:; guessing that in advance would widen the policy for
// nothing. Either way it degrades to the analyser fallback, never a broken
// ride.
const reportOnlyCSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob: https://i.ytimg.com https://*.giphy.com https://*.tenor.com; " +
	"media-src 'self' blob:; font-src 'self' data:; " +
	"connect-src 'self' wss: https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; " +
	"worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

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
