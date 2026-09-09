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
