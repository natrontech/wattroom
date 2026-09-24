package auth

// The rider's own reaction set (#2722): the four mid-ride cheer buttons and
// the head of the chat picker. It was the crew's (ADR-0013); it follows the
// rider now, into every crew and every DM. Its own route for the reason the
// home crew has one: written from its own control, it must not resend a
// profile form or race one.

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The six reactions every rider starts on. Icon keys since #447; the client
// draws them, and its STOCK_CHEERS is the same six.
var baseCheers = []string{"flame", "biceps-flexed", "party-popper", "skull", "rocket", "snowflake"}

// CheerSet parses the stored space-joined set; "" means the base set.
// Exported because the account export carries the set as the icons the rider
// actually reacts with (#2089), and "empty means the stock set" is a rule that
// must not be written down twice.
func CheerSet(stored string) []string {
	if stored == "" {
		return baseCheers
	}
	return strings.Fields(stored)
}

// cleanCheers validates a picked set and returns it stored: deduplicated and
// space-joined, "" for an empty pick (back to the base set). A non-empty
// refusal is the message to answer with.
func cleanCheers(picked []string) (stored, refusal string) {
	if len(picked) > protocol.MaxCheers {
		return "", fmt.Sprintf("Pick at most %d reactions.", protocol.MaxCheers)
	}
	deduped := make([]string, 0, len(picked))
	seen := map[string]struct{}{}
	for _, cheer := range picked {
		// An icon key or one emoji. Not a crew's own `:name:` (#2643): the
		// set goes with the rider into every crew and DM, and that name means
		// something in one crew only. The full picker still offers them.
		if !protocol.IsIconOrEmoji(cheer) {
			return "", "That is not a reaction — pick an icon or an emoji."
		}
		if _, dup := seen[cheer]; dup {
			continue
		}
		seen[cheer] = struct{}{}
		deduped = append(deduped, cheer)
	}
	return strings.Join(deduped, " "), ""
}

func (s *Service) handleSetCheers(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req struct {
		// [] resets to the base set.
		Cheers []string `json:"cheers"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	stored, refusal := cleanCheers(req.Cheers)
	if refusal != "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", refusal, "cheers")
		return
	}
	updated, err := s.store.Queries.SetUserCheers(r.Context(), db.SetUserCheersParams{ID: user.ID, Cheers: stored})
	if err != nil {
		httpx.Fail(w, s.log, "cheers update failed", err, "Your reactions could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}
