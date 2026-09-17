package httpx

import (
	"net"
	"net/http"
	"os"
	"strings"
)

// ClientIP is the caller's address: the LAST hop of X-Forwarded-For when
// something we trust is in front (deploy/Caddyfile), else the socket's peer.
// The key every per-address budget spends (auth's sign-in ceilings, the crew
// door — #1673). The last hop, not the first: a proxy appends the peer it
// saw, so the first entry is whatever the caller wrote — and a caller who
// wrote a fresh one per request had a fresh sign-in budget per request
// (#1824).
//
// "Only the deploy's own proxy can write the last one" held only where a
// proxy that appends was actually there (#2258). A self-hosted binary
// exposed directly has no proxy, so the whole header is caller-written and
// #1824 comes back by another route — a fresh budget per request, from one
// host, against every unauthenticated ceiling at once.
//
// So the header is honoured only when the peer is one of ours: loopback,
// private, or link-local. Behind the deploy's proxy that is true and nothing
// changes; exposed directly it is false and the header is ignored. No
// configuration, which matters because the failure mode of getting it wrong
// by default is every caller sharing one budget — the whole internet locked
// out of sign-in by one loop.
func ClientIP(r *http.Request) string {
	peer := peerIP(r)
	if trustsForwardedFor(peer) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			hops := strings.Split(xff, ",")
			for i := len(hops) - 1; i >= 0; i-- {
				if hop := strings.TrimSpace(hops[i]); hop != "" {
					return hop
				}
			}
		}
	}
	return peer
}

// trustsForwardedFor: is there something in front of us that appended the
// hop? True for a peer on this host or this network — which is every shape
// the proxy actually takes (same container network, same host, same LAN).
//
// WATTROOM_TRUSTED_PROXY=1 is the escape for the one topology this cannot
// see: a proxy on another PUBLIC host, a CDN in front of the origin. An
// operator who turns it on is saying "nothing reaches me except through it",
// and owns that.
func trustsForwardedFor(peer string) bool {
	if os.Getenv("WATTROOM_TRUSTED_PROXY") == "1" {
		return true
	}
	ip := net.ParseIP(peer)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast())
}

func peerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
