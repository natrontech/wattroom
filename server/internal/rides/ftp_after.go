// The FTP a ride produced, as opposed to the one it was scored against
// (#1572). `rides.ftp_watts` is captured at ride time, which is what makes
// the FTP trend a history rather than a reconstruction — and it is also why a
// ramp test's own ride carries the OLD number: the ride is saved the moment
// the test ends, before the rider has accepted anything. This endpoint is the
// second half of that moment: the rider pressed Save, so the ramp's ride can
// say what it produced and the trend can mark it the same day.
package rides

import (
	"fmt"
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleFtpAfter stamps one ride with the FTP it produced. Owner-only: the
// update's where clause carries the rider, so someone else's ride reads as
// absent rather than as forbidden — handleShare's rule.
//
// It stands alone rather than joining PATCH /api/rides/{id} because the two
// answer different questions: sharing is a rider's choice about a ride, this
// is a measurement the ride made. Only the ramp calls it; an ordinary ride
// never does, and its column stays null.
//
// Nothing here proves the ride WAS a ramp — the row keeps no workout JSON to
// check against, only a client-supplied name. It adds no trust surface: the
// rider already supplies the samples the FTP is computed from, and the column
// can only put one more mark on their own chart, so a rider lying to it lies
// only to themselves. A cookie is required, not a personal token: bearer auth
// is GET-only (ADR-0017), and RequireUser holds the Origin check for every
// mutating verb (#678).
func (s *Service) handleFtpAfter(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return
	}
	var body struct {
		FtpAfter *int16 `json:"ftpAfter"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil || body.FtpAfter == nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Send ftpAfter as the FTP this ride produced, in watts.", "ftpAfter")
		return
	}
	// The same bounds the profile write and the schema CHECK hold — a number
	// outside them is not an FTP, and the CHECK would refuse it as a 500.
	if *body.FtpAfter < stats.MinFtpWatts || *body.FtpAfter > stats.MaxFtpWatts {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			fmt.Sprintf("FTP has to be between %d and %d W.", stats.MinFtpWatts, stats.MaxFtpWatts), "ftpAfter")
		return
	}
	n, err := s.store.Queries.SetRideFtpAfter(r.Context(), db.SetRideFtpAfterParams{
		FtpAfterWatts: *body.FtpAfter, ID: id, UserID: user.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "ride ftp-after failed", err, "The ride could not be updated.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id": store.UUIDString(id), "ftpAfter": *body.FtpAfter,
	})
}
