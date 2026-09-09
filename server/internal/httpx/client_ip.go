package httpx

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP is the caller's address: the LAST hop of X-Forwarded-For behind
// the reverse proxy the deploy runs (deploy/Caddyfile), else the socket's
// peer. The key every per-address budget spends (auth's sign-in ceilings,
// the crew door — #1673). The last hop, not the first: a proxy appends the
// peer it saw, so the first entry is whatever the caller wrote — and a
// caller who wrote a fresh one per request had a fresh sign-in budget per
// request (#1824). Only the deploy's own proxy can write the last one.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		hops := strings.Split(xff, ",")
		for i := len(hops) - 1; i >= 0; i-- {
			if hop := strings.TrimSpace(hops[i]); hop != "" {
				return hop
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
