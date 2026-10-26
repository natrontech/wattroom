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
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
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
		// In the rider's own day, like every other date the app prints —
		// a ride at 19:42 must not read as tomorrow morning.
		StartedAt: row.StartedAt.Time.In(stats.Zone(user.Timezone)),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), NormWatts: normWatts(row),
		Kj: int(row.Kj), Ftp: int(row.FtpWatts), Xp: int(row.Xp),
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored,
	}
	// Where it was ridden, for the card's "in …": the voice channel, else
	// the crew (#2558) — never a room.
	card.Place = row.ChannelName
	if card.Place == "" {
		card.Place = row.CrewName
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
	onRoad := false
	for i, sample := range samples {
		card.Watts[i] = sample.Watts
		onRoad = onRoad || sample.M > 0
	}
	// A ride on a road is drawn as the road it rode (#3142): its metres and
	// heights beside the watts, under the route's generated name — never the
	// owner's own, which may name where they live (#3055) — and the line
	// that says where the heights came from.
	// Off a road, the rider's own name for the ride (#4209) titles its card.
	// On one it does not: free text can name where they live as surely as a
	// route's rename can, and the card is drawn to be posted. A road ride can
	// carry no metres (a session rider the bunch never placed, an unreadable
	// blob), so the row's own marks count too, as the Strava title's do.
	name := row.WorkoutName
	if row.Title != nil && !onRoad && row.RouteKey == nil && (row.OnRoad == nil || !*row.OnRoad) {
		name = *row.Title
	}
	if onRoad {
		card.Metres = make([]float64, len(samples))
		card.Heights = make([]float64, len(samples))
		for i, sample := range samples {
			card.Metres[i], card.Heights[i] = sample.M, sample.Alt
		}
		// Named by what was ridden, in the generated name's own numbers: a
		// workout over a 38 km road titled its 13 km poster with the road's
		// 38 (#4229). The drawing below it is the same metres.
		name = road.NameOf(ridden(samples))
		stored, err := s.store.Queries.GetRideRoad(r.Context(), db.GetRideRoadParams{ID: id, UserID: user.ID})
		if err != nil {
			s.log.Warn("ride card road unreadable", "err", err, "ride", store.UUIDString(row.ID))
		}
		card.HeightCredit = heightCredit(stored.EleSource)
	}
	card.WorkoutName = name

	png, err := og.RenderRide(card)
	if err != nil {
		httpx.Fail(w, s.log, "ride card render failed", err, "That ride's card could not be drawn.")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", cardFilename(row.StartedAt.Time, name)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	if _, err := w.Write(png); err != nil {
		s.log.Warn("ride card write failed", "err", err, "ride", store.UUIDString(row.ID))
	}
}

// heightCredit is where a road's heights came from, for the foot of its
// poster. The rider's own file credits nobody else; a height model, once the
// geo pack brings one, credits its source here (#3133).
func heightCredit(eleSource string) string {
	if eleSource == "file" {
		return "Heights from the route's own file"
	}
	return ""
}

// ridden is the metres and the climb a ride covered on its road (#4229):
// from its first placed second to its last, the climb summed over the
// heights it rode. Seconds before the road (M 0) are not on it.
func ridden(samples []protocol.RiderMetrics) (lengthM, gainM float64) {
	first, last := -1, -1
	for i, sample := range samples {
		if sample.M > 0 {
			if first < 0 {
				first = i
			}
			last = i
		}
	}
	if first < 0 {
		return 0, 0
	}
	for i := first + 1; i <= last; i++ {
		gainM += max(0, samples[i].Alt-samples[i-1].Alt)
	}
	return samples[last].M - samples[first].M, gainM
}

func cardFilename(startedAt time.Time, workout string) string {
	return fmt.Sprintf("wattroom-%s-%s.png", startedAt.UTC().Format("2006-01-02"), workoutSlug(workout))
}
