package auth

import (
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
)

// The per-address ceilings on the endpoints anyone can reach (#1606). Every
// other ceiling here is per account; these are the doors a stranger knocks
// on. Sized for a rider retrying a flaky passkey prompt, not for a loop:
// past them the challenge store used to fill for everyone (503, a global
// denial from one address) and the synthetic bearer took unlimited guesses.
const (
	loginAttemptsPerWindow = 30
	loginWindow            = time.Minute
	syntheticPerWindow     = 10
)

// ipOf is the caller's address: the first hop of X-Forwarded-For behind the
// reverse proxy the deploy runs (deploy/Caddyfile), else the socket's peer.
func ipOf(r *http.Request) string {
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

// throttle answers 429 and reports true when this address has spent its
// window on `b`. A nil budget (a bare test service) never throttles.
func (s *Service) throttle(w http.ResponseWriter, r *http.Request, b *budget.Budget[string]) bool {
	if b == nil || b.Spend(ipOf(r)) {
		return false
	}
	httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
		"Too many sign-in attempts from this address — wait a minute and try again.")
	return true
}
