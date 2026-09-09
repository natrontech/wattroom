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
const reportOnlyCSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' blob:; font-src 'self' data:; " +
	"connect-src 'self' wss: https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; " +
	"worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

// secured is the second line of defence the app document never had (#1609):
// nothing may frame WattRoom, a response's type is what it says, a rider's
// URL does not ride a referrer to another site in full, and a browser that
// has seen the site over TLS stays on TLS (#1737 — HSTS is ignored over
// plain http, so a laptop's dev server is untouched; no includeSubDomains,
// a self-hoster's other subdomains are not this binary's to decide).
func secured(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", enforcedCSP)
		h.Set("Content-Security-Policy-Report-Only", reportOnlyCSP)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Strict-Transport-Security", "max-age=31536000")
		next.ServeHTTP(w, r)
	})
}

// apiNotFound is the API's own 404 for a path no handler owns (#1604).
func apiNotFound(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteError(w, http.StatusNotFound, "not_found", "No such API route.")
}
