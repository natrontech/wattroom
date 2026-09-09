package httpx

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP is the caller's address: the first hop of X-Forwarded-For behind
// the reverse proxy the deploy runs (deploy/Caddyfile), else the socket's
// peer. The key every per-address budget spends (auth's sign-in ceilings,
// the crew door — #1673).
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if first, _, ok := strings.Cut(xff, ","); ok {
			return strings.TrimSpace(first)
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
