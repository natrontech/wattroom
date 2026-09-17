package httpx

import (
	"net"
	"net/http"
	"strings"
	"sync/atomic"
)

// trustProxy says whether X-Forwarded-For may be believed at all. Off until
// the deploy says otherwise, because the header is caller-written unless
// something in front rewrites it — see TrustProxyHeader.
var trustProxy atomic.Bool

// TrustProxyHeader is the boot switch for X-Forwarded-For, set from
// WATTROOM_TRUSTED_PROXY (#2258). Call it before serving.
//
// The header is the only input to ClientIP that the caller controls, and
// ClientIP is the key every unauthenticated ceiling spends — the sign-in
// budget, the synthetic door, the recovery door, the crew door. A binary
// exposed directly reads whatever the caller wrote, so a fresh header per
// request is a fresh budget per request: #1824's bug by another route, and
// what makes the key space unbounded from a single host. Defaulting to off
// means the bare binary is safe and the deploy opts in, rather than the
// other way round.
func TrustProxyHeader(trust bool) { trustProxy.Store(trust) }

// ClientIP is the caller's address: the socket's peer, or — when the deploy
// has declared a proxy in front (TrustProxyHeader) — the LAST hop of
// X-Forwarded-For. The key every per-address budget spends (auth's sign-in
// ceilings, the crew door — #1673).
//
// The last hop, not the first: a proxy appends the peer it saw, so the first
// entry is whatever the caller wrote, and a caller who wrote a fresh one per
// request had a fresh sign-in budget per request (#1824). Only a proxy that
// is actually there can write the last one, which is the part the switch
// above makes true instead of assumed.
func ClientIP(r *http.Request) string {
	if trustProxy.Load() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			hops := strings.Split(xff, ",")
			for i := len(hops) - 1; i >= 0; i-- {
				if hop := strings.TrimSpace(hops[i]); hop != "" {
					return hop
				}
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
