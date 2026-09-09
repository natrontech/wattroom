package rides

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/fitexport"
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

// exportDestination is the one provider today; the column exists so a second
// is a row rather than a schema change (#799). Named here so the retry and
// the read cannot drift onto different strings.
const exportDestination = "strava"

// handleRetryExport puts a delivery that ran out of attempts back in the
// queue (#1158).
//
// It exists because no backoff survives an outage longer than itself: five
// attempts over a couple of hours covers most of them and not all, and what
// was there before was a dead row and a message telling the rider to
// reconnect an account that was never disconnected. This is the one big
// button errors.md asks for — the sweep does the rest, so there is no second
// delivery path to keep in step with the first.
func (s *Service) handleRetryExport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return
	}
	// The ride first, so somebody else's ride is not-found rather than a
	// silent no-op that reads like success.
	if _, err := s.store.Queries.GetRide(r.Context(), db.GetRideParams{ID: id, UserID: user.ID}); errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	} else if err != nil {
		s.log.Error("ride retry read failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That ride could not be loaded.")
		return
	}
	rows, err := s.store.Queries.RequeueRideExport(r.Context(), db.RequeueRideExportParams{
		RideID: id, Destination: exportDestination,
	})
	if err != nil {
		s.log.Error("ride retry failed", "err", err, "ride", store.UUIDString(id))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That could not be queued. Try again.")
		return
	}
	if rows == 0 {
		// Nothing failed to retry: either it is already queued, or it went
		// through. Saying so beats a 200 that promises something happened.
		httpx.WriteError(w, http.StatusConflict, "conflict",
			"That ride is not waiting to be sent — it either went through or is already queued.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleExport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
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
		s.log.Error("ride export read failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That ride could not be loaded.")
		return
	}
	if len(row.Samples) == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "This ride has no samples to export.")
		return
	}
	metrics, err := stats.DecodeSamples(row.Samples)
	if err != nil {
		s.log.Error("ride export samples unreadable", "err", err, "ride", store.UUIDString(row.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That ride's samples could not be read.")
		return
	}
	if len(metrics) == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "This ride has no samples to export.")
		return
	}
	samples := make([]fitexport.Sample, len(metrics))
	for i, m := range metrics {
		samples[i] = fitexport.Sample{Second: i, Watts: uint16(max(0, min(65535, m.Watts))), Cadence: uint8(max(0, min(255, m.Cadence))), HeartRate: uint8(max(0, min(255, m.HR)))}
	}
	data, err := fitexport.Encode(fitexport.Ride{StartedAt: row.StartedAt.Time, Samples: samples})
	if err != nil {
		s.log.Error("ride export encode failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That ride could not be exported.")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.ant.fit")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", exportFilename(row.StartedAt.Time, row.WorkoutName)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		s.log.Warn("ride export write failed", "err", err, "ride", store.UUIDString(row.ID))
	}
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
	// #1143: false when the workout prescribed nothing to score, so a client
	// shows "not scored" rather than a percentage that means nothing.
	ExecutionScored bool `json:"executionScored"`
	Ftp             int  `json:"ftp"`
	Xp              int  `json:"xp"`
	// The room it was ridden in; nil for a solo ride.
	Room *roomJSON `json:"room"`
	// Medals this ride won, SPEC kinds — empty for a solo or unmedalled ride.
	Medals []medalJSON `json:"medals"`
	// The per-second series, watts always, hr/cadence when the ride carried
	// them. Empty if the blob cannot be read: the numbers are still true, and
	// a ride the rider wants gone must still open.
	Samples []sampleJSON `json:"samples"`
	// Where this ride was sent, and whether it arrived. Absent when the ride
	// was never eligible — no Strava on the account, or auto-upload off.
	Export *exportJSON `json:"export,omitempty"`
}

// exportJSON is one delivery's durable state (#799): a rider who turned
// auto-upload on deserves to know whether the ride actually got there.
type exportJSON struct {
	Destination string `json:"destination"`
	// pending | delivered | failed.
	State string `json:"state"`
	// The remote's own id for it, once delivered — 0 until then.
	RemoteID int64 `json:"remoteId,omitempty"`
	// What went wrong last, while it is still going wrong.
	Error string `json:"error,omitempty"`
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
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(row.FtpWatts), Xp: int(row.Xp),
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
	// A missing row is the answer for every ride nobody tried to send.
	if export, exportErr := s.store.Queries.GetRideExport(r.Context(), db.GetRideExportParams{
		RideID: id, Destination: exportDestination,
	}); exportErr == nil {
		out.Export = &exportJSON{Destination: exportDestination, State: export.State}
		if export.RemoteID != nil {
			out.Export.RemoteID = *export.RemoteID
		}
		// Only while it is still going wrong: a delivered ride's last error is
		// a scar, not a status.
		if export.State != "delivered" && export.LastError != nil {
			out.Export.Error = *export.LastError
		}
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

// exportFilename names the download by the day and the workout (#1549): five
// files named by uuid were five files a rider could not tell apart.
func exportFilename(startedAt time.Time, workout string) string {
	var slug []rune
	dash := true
	for _, r := range strings.ToLower(workout) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			slug = append(slug, r)
			dash = false
		} else if !dash {
			slug = append(slug, '-')
			dash = true
		}
		if len(slug) >= 40 {
			break
		}
	}
	name := strings.Trim(string(slug), "-")
	if name == "" {
		name = "ride"
	}
	return fmt.Sprintf("wattroom-%s-%s.fit", startedAt.UTC().Format("2006-01-02"), name)
}
