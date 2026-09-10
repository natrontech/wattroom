package auth

// The rider's timezone (#858). Every absolute time WattRoom mails used to be
// formatted with the *server's* zone, which is right only for riders who
// happen to share it.
//
// Nobody is asked for this. `Intl.DateTimeFormat().resolvedOptions().timeZone`
// already knows, so the client reports it and it corrects itself when a rider
// moves; a timezone picker would fail the 95% rule in .claude/rules/ux.md. It
// gets its own route rather than a field on PATCH /api/me, which validates a
// whole profile form on every call — a background write of one value should
// not have to resend a display name, and should not race a profile edit in
// another tab.

import (
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Long enough for any real IANA name ("America/Argentina/ComodRivadavia" is 31)
// and short enough that nothing else fits.
const maxTimezoneName = 64

func (s *Service) handleUpdateTimezone(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req struct {
		Timezone string `json:"timezone"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That timezone could not be read.")
		return
	}
	// LoadLocation is the validation: it accepts exactly the names the
	// formatter will later resolve, so a name stored here cannot fail at send
	// time. The tzdata is embedded (see main.go), not the host's.
	if len(req.Timezone) > maxTimezoneName {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a timezone name.", "timezone")
		return
	}
	// "Local" is refused although LoadLocation accepts it: it resolves to the
	// SERVER's zone, which is the one thing a rider's day must not depend on
	// (#2063), and Postgres does not know the name at all — the queries that
	// bucket in SQL error on it. stats.Zone refuses it a second time on the
	// read side, so an already-stored one is harmless; this keeps it out.
	// Intl.DateTimeFormat never reports it, so no real client loses anything.
	if _, err := time.LoadLocation(req.Timezone); err != nil || req.Timezone == "" || req.Timezone == "Local" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a timezone name.", "timezone")
		return
	}
	if err := s.store.Queries.UpdateUserTimezone(r.Context(), db.UpdateUserTimezoneParams{
		ID: user.ID, Timezone: &req.Timezone,
	}); err != nil {
		httpx.Fail(w, s.log, "timezone update failed", err, "Your timezone could not be saved. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
