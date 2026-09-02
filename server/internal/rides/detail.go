package rides

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// One past ride, opened (#503). The list is summaries; this is the single
// read ADR-0016 keeps the sample blob for — the trace, the zones and the
// numbers of one ride, plus what it won and where it was ridden.

type medalJSON struct {
	Kind      string `json:"kind"`
	RoomName  string `json:"roomName"`
	AwardedAt string `json:"awardedAt"`
}

// roomJSON names the room a ride happened in; nil for a solo ride.
type roomJSON struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type rideDetailJSON struct {
	ID          string  `json:"id"`
	WorkoutName string  `json:"workoutName"`
	StartedAt   string  `json:"startedAt"`
	Seconds     int     `json:"seconds"`
	AvgWatts    int     `json:"avgWatts"`
	NormWatts   int     `json:"normWatts"`
	Kj          int     `json:"kj"`
	Execution   float64 `json:"execution"`
	Ftp         int     `json:"ftp"`
	Xp          int     `json:"xp"`
	// The room it was ridden in; nil for a solo ride.
	Room *roomJSON `json:"room"`
	// Medals this ride won, SPEC kinds — empty for a solo or unmedalled ride.
	Medals []medalJSON `json:"medals"`
	// The per-second series, watts always, hr/cadence when the ride carried
	// them. Empty if the blob cannot be read: the numbers are still true, and
	// a ride the rider wants gone must still open.
	Samples []sampleJSON `json:"samples"`
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return
	}
	// Owner-scoped by the query: someone else's ride reads as absent, never
	// as forbidden — a 403 would confirm the ride exists.
	row, err := s.store.Queries.GetRide(r.Context(), db.GetRideParams{ID: id, UserID: user.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	if err != nil {
		s.log.Error("ride read failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That ride could not be loaded.")
		return
	}
	medalRows, err := s.store.Queries.ListRideMedals(r.Context(), id)
	if err != nil {
		s.log.Error("ride medals read failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That ride could not be loaded.")
		return
	}

	out := rideDetailJSON{
		ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
		StartedAt: row.StartedAt.Time.Format(time.RFC3339),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts),
		NormWatts: normWatts(row), Kj: int(row.Kj),
		Execution: float64(row.Execution), Ftp: int(row.FtpWatts), Xp: int(row.Xp),
		Medals:  make([]medalJSON, 0, len(medalRows)),
		Samples: []sampleJSON{},
	}
	if row.RoomID.Valid {
		out.Room = &roomJSON{Slug: row.RoomSlug, Name: row.RoomName}
	}
	for _, medal := range medalRows {
		out.Medals = append(out.Medals, medalJSON{
			Kind: medal.Kind, RoomName: medal.RoomName,
			AwardedAt: medal.AwardedAt.Time.Format(time.RFC3339),
		})
	}
	samples, err := stats.DecodeSamples(row.Samples)
	if err != nil {
		// One unreadable blob costs this ride its trace, not its page.
		s.log.Error("ride samples unreadable", "err", err, "ride", store.UUIDString(row.ID))
	}
	for _, sample := range samples {
		out.Samples = append(out.Samples, sampleJSON{
			Watts: sample.Watts, HR: sample.HR, Cadence: sample.Cadence,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// normWatts falls back to the average for rides the ADR-0016 backfill has not
// reached — the same coalesce ListUserProgression does.
func normWatts(row db.GetRideRow) int {
	if row.NormWatts == nil {
		return int(row.AvgWatts)
	}
	return int(*row.NormWatts)
}

// handleDelete is the rider throwing one of their own rides away. Destructive
// and unrecoverable — the sample blob is not kept anywhere else — so the
// confirmation lives client-side and this just deletes once. The ride's medals
// go with it through medals.ride_id's on-delete-cascade.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return
	}
	n, err := s.store.Queries.DeleteRide(r.Context(), db.DeleteRideParams{ID: id, UserID: user.ID})
	if err != nil {
		s.log.Error("ride delete failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The ride could not be deleted. It is still there — try again.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	s.log.Info("ride deleted", "ride", store.UUIDString(id))
	w.WriteHeader(http.StatusNoContent)
}
