package auth

import (
	"net/http"
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
	// Recovery (#1822) is two ceilings, because the two things worth
	// bounding are different: how fast one caller may knock, and how much
	// mail one inbox can be sent no matter how many callers do the knocking.
	// Room for a rider mistyping their address a few times; nowhere near
	// enough to walk a list of addresses or to bury someone in link mail.
	recoverAsksPerWindow  = 5 // per client address, per loginWindow
	recoverMailsPerWindow = 3 // per email address asked about
	recoverMailWindow     = time.Hour
)

// throttle answers 429 and reports true when this address has spent its
// window on `b`. A nil budget (a bare test service) never throttles.
func (s *Service) throttle(w http.ResponseWriter, r *http.Request, b *budget.Budget[string]) bool {
	if b == nil || b.Spend(httpx.ClientIP(r)) {
		return false
	}
	httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
		"Too many sign-in attempts from this address — wait a minute and try again.")
	return true
}
