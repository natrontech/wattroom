package main

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// secured is the second line of defence the app document never had (#1609):
// nothing may frame WattRoom, a response's type is what it says, and a
// rider's URL does not ride a referrer to another site in full. A
// script-src policy is a separate change — the player and LiveKit want
// their own allowances and a wrong one takes the ride down.
func secured(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// apiNotFound is the API's own 404 for a path no handler owns (#1604).
func apiNotFound(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteError(w, http.StatusNotFound, "not_found", "No such API route.")
}
