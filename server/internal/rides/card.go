package rides

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/og"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/tokens"
)

// The ride card (#2112). Strava's API uploads the activity and never a photo
// for it, so the picture of a ride can only reach Strava the way a rider's
// own photos do — from their device, added by hand. This hands them one worth
// adding: the same numbers the ride's page shows, drawn once, square.
//
// Owner-scoped and never cached in the clear: a card carries the ride's whole
// shape, which is exactly the record ADR-0008 keeps on the account.
func (s *Service) handleCard(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	// A personal token reads summaries (ADR-0017); the per-second record the
	// trace is drawn from stays on the account (#1757, ADR-0008).
	if tokens.Bearer(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"A personal token reads ride summaries only — the second-by-second record stays on your account.")
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return
	}
	row, err := s.store.Queries.GetRide(r.Context(), db.GetRideParams{ID: id, UserID: user.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "ride card read failed", err, "That ride could not be loaded.")
		return
	}

	card := og.RideCard{
		WorkoutName: row.WorkoutName,
		// In the rider's own day, like every other date the app prints —
		// a ride at 19:42 must not read as tomorrow morning.
		StartedAt: row.StartedAt.Time.In(stats.Zone(user.Timezone)),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), NormWatts: normWatts(row),
		Kj: int(row.Kj), Ftp: int(row.FtpWatts), Xp: int(row.Xp),
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored,
	}
	if row.RoomID.Valid {
		card.RoomName = row.RoomName
	}
	var curve stats.Curve
	if json.Unmarshal(row.Curve, &curve) == nil {
		card.Curve = curve
	}
	// One unreadable blob costs this card its trace, not the card — the same
	// call handleGet makes for the page.
	samples, err := stats.DecodeSamples(row.Samples)
	if err != nil {
		s.log.Error("ride card samples unreadable", "err", err, "ride", store.UUIDString(row.ID))
	}
	card.Watts = make([]int, len(samples))
	for i, sample := range samples {
		card.Watts[i] = sample.Watts
	}

	png, err := og.RenderRide(card)
	if err != nil {
		httpx.Fail(w, s.log, "ride card render failed", err, "That ride's card could not be drawn.")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", cardFilename(row.StartedAt.Time, row.WorkoutName)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	if _, err := w.Write(png); err != nil {
		s.log.Warn("ride card write failed", "err", err, "ride", store.UUIDString(row.ID))
	}
}

func cardFilename(startedAt time.Time, workout string) string {
	return fmt.Sprintf("wattroom-%s-%s.png", startedAt.UTC().Format("2006-01-02"), workoutSlug(workout))
}
