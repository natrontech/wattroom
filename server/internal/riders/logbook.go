package riders

import (
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
)

// logbookJSON is the logbook on the cozy room's desk (docs/spec/lounge.md):
// the rider's own numbers, for them alone. The level is drawn from TotalXp
// as everywhere else; voice time is hangout and never paid.
type logbookJSON struct {
	TotalXp     int64 `json:"totalXp"`
	StreakWeeks int   `json:"streakWeeks"`
	Rides       int64 `json:"rides"`
	RideSec     int64 `json:"rideSec"`
	VoiceSec    int64 `json:"voiceSec"`
}

// handleLogbook answers GET /api/me/logbook. There is no id in the path:
// another rider's logbook is not a request this route can express, and the
// rider streak and voice time are on no other rider's surface.
func (s *Service) handleLogbook(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Sign in to read your logbook.")
	if !ok {
		return
	}
	row, err := s.store.Queries.RiderLogbook(r.Context(), me.ID)
	if err != nil {
		httpx.Fail(w, s.log, "logbook read failed", err, "Your logbook could not be loaded. Try again.", "user", store.UUIDString(me.ID))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, logbookJSON{
		TotalXp:     row.TotalXp,
		StreakWeeks: stats.RiderStreak(r.Context(), s.store.Queries, me.ID, time.Now()),
		Rides:       row.Rides, RideSec: row.RideSeconds, VoiceSec: row.VoiceSeconds,
	})
}
