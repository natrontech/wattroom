// Package rides is the solo half of ride persistence (#110): a room session
// is saved by the hub's saver when it closes; a solo ride posts itself here
// when it ends. Same row builder, same XP streak term, room_id NULL — one
// history feeding streaks, curves and the FTP suggestion either way.
package rides

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/keyset"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Bounds mirror the WS metrics gate and fitexport: attacker-controlled
// series, capped before any of it is believed.
const (
	maxSamples   = 6 * 60 * 60 // 6 h at 1 Hz — longer than any indoor session
	minSamples   = 60          // under a minute is a misclick, the saver's rule
	maxBodyBytes = 4 << 20
	maxWatts     = 3000
	// The rider's trim, as workout/guards bounds it and protocol.BiasOr clamps it.
	minBias    = 0.8
	maxBias    = 1.2
	maxCadence = 250
	maxHR      = 250
	// Saves per account per minute (#2251). POST /api/rides was the one
	// rider-created row with no ceiling at all, while every neighbour has
	// one — custom workouts 200 per account, MCP 60 calls a minute, OG cards
	// 30. A ride is at least a minute of samples and a real client posts one
	// when a ride ends, so ten covers a rider whose upload failed and who
	// tried again, and nothing covers a loop: the rows are up to 4 MB each
	// and they are what GET /api/me/export builds in memory.
	savesPerWindow = 10
	saveWindow     = time.Minute
	// What uploaded rides may pay a rider in one UTC save day, whatever they
	// claim (#3044, docs/SPEC.md's XP sources): about six hours at 280 W.
	// The samples here are the client's word, and without it one scripted
	// save was worth ~65,000 XP. A ride the hub saved from a live session is
	// outside it — the server watched those seconds arrive.
	maxUploadXpPerDay = 6000
)

type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// RideUploader mirrors stats.RideUploader — a saved solo ride goes to the
// same external worker; nil means the feature is absent.
type RideUploader interface {
	RideSaved(rideID pgtype.UUID)
}

type Service struct {
	store    *store.Store
	users    UserSource
	log      *slog.Logger
	uploader RideUploader
	keeper   stats.RideKeeper
	saves    *budget.Budget[pgtype.UUID]
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log,
		saves: budget.New[pgtype.UUID](savesPerWindow, saveWindow)}
}

func (s *Service) SetUploader(u RideUploader) { s.uploader = u }

// SetRideKeeper wires the trophy case in (#467): a solo ride earns its
// achievements the same way a room session's does.
func (s *Service) SetRideKeeper(k stats.RideKeeper) { s.keeper = k }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/rides", s.handleList)
	mux.HandleFunc("GET /api/rides/best", s.handleBest)
	mux.HandleFunc("POST /api/rides", s.handleCreate)
	mux.HandleFunc("GET /api/rides/{id}", s.handleGet)
	mux.HandleFunc("GET /api/rides/{id}/export", s.handleExport)
	// A picture of the ride, for the rider to put wherever pictures go (#2112).
	mux.HandleFunc("GET /api/rides/{id}/card.png", s.handleCard)
	mux.HandleFunc("POST /api/rides/{id}/export/retry", s.handleRetryExport)
	mux.HandleFunc("PATCH /api/rides/{id}", s.handleShare)
	mux.HandleFunc("PUT /api/rides/{id}/ftp-after", s.handleFtpAfter)
	// What the rider says about the ride, next to what the trainer said (#2328).
	mux.HandleFunc("PUT /api/rides/{id}/feel", s.handleFeel)
	mux.HandleFunc("DELETE /api/rides/{id}", s.handleDelete)
}

type rideJSON struct {
	ID          string  `json:"id"`
	WorkoutName string  `json:"workoutName"`
	StartedAt   string  `json:"startedAt"`
	Seconds     int     `json:"seconds"`
	AvgWatts    int     `json:"avgWatts"`
	Kj          int     `json:"kj"`
	Execution   float64 `json:"execution"`
	// #1143: false when the workout prescribed nothing to score, so a client
	// shows "not scored" rather than a percentage that means nothing.
	ExecutionScored bool `json:"executionScored"`
	Ftp             int  `json:"ftp"`
	Xp              int  `json:"xp"`
	// True for rides ridden with a crew — the list marks them. The key is the
	// list's from before crews (#2558).
	Room bool `json:"room,omitempty"`
	// The crew it was ridden with and the voice channel it was ridden in
	// (#2443); nil for a solo ride.
	Crew    *placeJSON `json:"crew,omitempty"`
	Channel *placeJSON `json:"channel,omitempty"`
	// The per-ride opt-in (WATTROOM.md privacy, ADR-0024): friends see this
	// ride on the rider's page. Off by default, flipped by PATCH.
	SharedWithFriends bool `json:"sharedWithFriends"`
	// The Strava delivery's state — pending | delivered | failed — when the
	// ride has one (#1553), so the list can mark a failed upload; empty for a
	// ride that was never sent. The detail carries the whole record.
	ExportState string `json:"exportState,omitempty"`
}

// placeJSON names where a ride happened — a crew, or a channel of one.
type placeJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// placeOf is nil for a ride that was not ridden there.
func placeOf(id pgtype.UUID, name string) *placeJSON {
	if !id.Valid {
		return nil
	}
	return &placeJSON{ID: store.UUIDString(id), Name: name}
}

// listPage is one page of the rides list (#1549): the list used to be one
// read capped at 200, and a rider's older rides fell off the end of the app.
const listPage = 100

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	params := db.ListUserRidesParams{UserID: user.ID, Limit: listPage, Destination: exportDestination}
	// The cursor is the previous page's last row, handed back verbatim: a
	// time and the ride id that breaks its tie. Both or neither — half a
	// cursor would page from a time with no tie-break, which is #2064.
	cursor, ok := keyset.FromQuery(w, r, "ride")
	if !ok {
		return
	}
	cursor.Apply(&params.Before, &params.BeforeID)
	rows, err := s.store.Queries.ListUserRides(r.Context(), params)
	if err != nil {
		httpx.Fail(w, s.log, "list rides failed", err, "Your rides could not be loaded.")
		return
	}
	out := make([]rideJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, rideJSONOf(row))
	}
	body := map[string]any{"rides": out, "more": len(rows) == listPage}
	// A full page means there may be more, and the cursor comes from the
	// server rather than from the rider's own `startedAt`: that field is
	// RFC 3339 to the second where started_at is microseconds, and a cursor
	// rounded down by a fraction of a second stepped over every ride inside
	// it (#2064) — including ones this page had not handed over. keyset.Next
	// is what keeps the precision.
	if len(rows) == listPage {
		last := rows[len(rows)-1]
		keyset.Next(body, last.StartedAt, last.ID)
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

func rideJSONOf(row db.ListUserRidesRow) rideJSON {
	out := rideJSON{
		ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
		StartedAt: row.StartedAt.Time.Format(time.RFC3339),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(row.FtpWatts), Xp: int(row.Xp),
		Room: row.InSession, SharedWithFriends: row.SharedAt.Valid,
		Crew: placeOf(row.CrewID, row.CrewName), Channel: placeOf(row.ChannelID, row.ChannelName),
	}
	if row.ExportState != nil {
		out.ExportState = *row.ExportState
	}
	return out
}

// handleBest answers the ride page's "against your best" (#1687): the
// hardest ride of the same workout over the whole history. The page used
// to scan the first page of the list and call a year-old workout a first.
func (s *Service) handleBest(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	workout := r.URL.Query().Get("workout")
	if workout == "" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "workout names the workout to compare against.")
		return
	}
	var except pgtype.UUID
	if raw := r.URL.Query().Get("except"); raw != "" {
		id, err := store.ParseUUID(raw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "except must be a ride id.")
			return
		}
		except = id
	}
	row, err := s.store.Queries.BestUserRideOfWorkout(r.Context(), db.BestUserRideOfWorkoutParams{
		UserID: user.ID, WorkoutName: workout, ExceptID: except, Destination: exportDestination,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ride": nil})
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "best ride failed", err, "Your rides could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ride": rideJSONOf(db.ListUserRidesRow(row))})
}

// handleShare flips one ride's friends-visibility (ADR-0024). Owner-only:
// the update's where clause carries the user, so someone else's ride reads
// as absent rather than as forbidden.
func (s *Service) handleShare(w http.ResponseWriter, r *http.Request) {
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
		SharedWithFriends *bool `json:"sharedWithFriends"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil || body.SharedWithFriends == nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Send sharedWithFriends as true or false.", "sharedWithFriends")
		return
	}
	n, err := s.store.Queries.SetRideShared(r.Context(), db.SetRideSharedParams{
		Shared: *body.SharedWithFriends, ID: id, UserID: user.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "ride share failed", err, "The ride could not be updated.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id": store.UUIDString(id), "sharedWithFriends": *body.SharedWithFriends,
	})
}
