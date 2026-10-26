// Package rides is the solo half of ride persistence (#110): a room session
// is saved by the hub's saver when it closes; a solo ride posts itself here
// when it ends. Same row builder, same XP streak term, room_id NULL — one
// history feeding streaks, curves and the FTP suggestion either way.
package rides

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/keyset"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/tokens"
)

// An attacker-controlled series, capped before any of it is believed: the
// samples by protocol's MaxRideSamples and metric bounds, the body here.
const (
	maxBodyBytes = 4 << 20
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
	mux.HandleFunc("PATCH /api/rides/{id}", s.handlePatch)
	mux.HandleFunc("PUT /api/rides/{id}/ftp-after", s.handleFtpAfter)
	// What the rider says about the ride, next to what the trainer said (#2328).
	mux.HandleFunc("PUT /api/rides/{id}/feel", s.handleFeel)
	mux.HandleFunc("DELETE /api/rides/{id}", s.handleDelete)
}

type rideJSON struct {
	ID          string `json:"id"`
	WorkoutName string `json:"workoutName"`
	// The rider's own name for the ride (#4209), on their own reads only:
	// free text can name any place, so a personal token, which is how an AI
	// reads (ADR-0017, ADR-0063), never carries it.
	Title     string  `json:"title,omitempty"`
	StartedAt string  `json:"startedAt"`
	Seconds   int     `json:"seconds"`
	AvgWatts  int     `json:"avgWatts"`
	Kj        int     `json:"kj"`
	Execution float64 `json:"execution"`
	// #1143: false when the workout prescribed nothing to score, so a client
	// shows "not scored" rather than a percentage that means nothing.
	ExecutionScored bool `json:"executionScored"`
	Ftp             int  `json:"ftp"`
	Xp              int  `json:"xp"`
	// True for rides ridden with a crew — the list marks them (#2558, #2959).
	InSession bool `json:"inSession,omitempty"`
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
	// A road ride's metres and climbing (#3053), the server's replay of them;
	// absent on a ride with no road.
	DistanceM *int32 `json:"distanceM,omitempty"`
	ClimbedM  *int32 `json:"climbedM,omitempty"`
	// The rider's own road it rode (#3874), on their own list only: a ride
	// saved under no name of its own is titled by it.
	Road *rideRoadJSON `json:"road,omitempty"`
}

// rideRoadJSON is a route of the rider's own that a ride rode: the name they
// know it by, and the generated one a session on it was saved under. Only
// ever on the owner's read of their own ride (ADR-0063).
type rideRoadJSON struct {
	RouteID string `json:"routeId"`
	Name    string `json:"name"`
	GenName string `json:"genName"`
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
	ids := make([]pgtype.UUID, 0, len(rows))
	for _, row := range rows {
		out = append(out, rideJSONOf(row))
		ids = append(ids, row.ID)
	}
	// A personal token is how a coach's AI reads (ADR-0017), and a route's
	// id and its owner's rename never reach an AI context (ADR-0063) — nor
	// does the rider's own name for a ride (#4209).
	if !tokens.Bearer(r) {
		s.nameOwnRoads(r.Context(), user.ID, ids, out)
		for i, row := range rows {
			out[i].Title = titleOf(row.Title)
		}
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

// nameOwnRoads adds the rider's own road to each ride on one (#3874); ids are
// the rides' own. An unreadable road costs the rides its name, not the list.
func (s *Service) nameOwnRoads(ctx context.Context, user pgtype.UUID, ids []pgtype.UUID, rides []rideJSON) {
	at := make(map[string]int, len(rides))
	for i, ride := range rides {
		at[ride.ID] = i
	}
	roads, err := s.store.Queries.OwnRoadsOfRides(ctx, db.OwnRoadsOfRidesParams{UserID: user, Ids: ids})
	if err != nil {
		s.log.Warn("ride roads unreadable", "err", err)
		return
	}
	for _, road := range roads {
		if i, ok := at[store.UUIDString(road.ID)]; ok {
			rides[i].Road = &rideRoadJSON{RouteID: store.UUIDString(road.RouteID), Name: road.Name, GenName: road.GenName}
		}
	}
}

func rideJSONOf(row db.ListUserRidesRow) rideJSON {
	out := rideJSON{
		ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
		StartedAt: row.StartedAt.Time.Format(time.RFC3339),
		Seconds:   int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
		Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(row.FtpWatts), Xp: int(row.Xp),
		InSession: row.InSession, SharedWithFriends: row.SharedAt.Valid,
		Crew: placeOf(row.CrewID, row.CrewName), Channel: placeOf(row.ChannelID, row.ChannelName),
		DistanceM: row.DistanceM, ClimbedM: row.ClimbedM,
	}
	if row.ExportState != nil {
		out.ExportState = *row.ExportState
	}
	return out
}

// handleBest answers the ride page's "against your best" (#1687): the
// hardest ride of the same workout over the whole history — or, for a ride
// titled by its road, the best ride of that road (#3874). The page used to
// scan the first page of the list and call a year-old workout a first.
func (s *Service) handleBest(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	query := r.URL.Query()
	workout, route := query.Get("workout"), query.Get("route")
	if workout == "" && route == "" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "workout or route names what to compare against.")
		return
	}
	var except pgtype.UUID
	if raw := query.Get("except"); raw != "" {
		id, err := store.ParseUUID(raw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "except must be a ride id.")
			return
		}
		except = id
	}
	var row db.ListUserRidesRow
	var err error
	if route != "" {
		routeID, perr := store.ParseUUID(route)
		if perr != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "route must be a route id.")
			return
		}
		var on db.BestUserRideOnRoadRow
		on, err = s.store.Queries.BestUserRideOnRoad(r.Context(), db.BestUserRideOnRoadParams{
			UserID: user.ID, RouteID: routeID, ExceptID: except, Destination: exportDestination,
		})
		row = db.ListUserRidesRow(on)
	} else {
		var of db.BestUserRideOfWorkoutRow
		of, err = s.store.Queries.BestUserRideOfWorkout(r.Context(), db.BestUserRideOfWorkoutParams{
			UserID: user.ID, WorkoutName: workout, ExceptID: except, Destination: exportDestination,
		})
		row = db.ListUserRidesRow(of)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ride": nil})
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "best ride failed", err, "Your rides could not be loaded.")
		return
	}
	best := rideJSONOf(row)
	if !tokens.Bearer(r) {
		best.Title = titleOf(row.Title)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ride": best})
}

// handlePatch flips one ride's friends-visibility (ADR-0024) and names it
// (#4209), either or both. Owner-only: each update's where clause carries the
// user, so someone else's ride reads as absent rather than as forbidden.
func (s *Service) handlePatch(w http.ResponseWriter, r *http.Request) {
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
		// The rider's name for the ride; "" gives it its workout's name back.
		Title *string `json:"title"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil || (body.SharedWithFriends == nil && body.Title == nil) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Send sharedWithFriends as true or false, or title as text.", "sharedWithFriends")
		return
	}
	title := trimWritten(body.Title)
	if title != nil && utf8.RuneCountInString(*title) > protocol.MaxWorkoutNameChars {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			fmt.Sprintf("A ride's name is up to %d characters — this one is %d.",
				protocol.MaxWorkoutNameChars, utf8.RuneCountInString(*title)), "title")
		return
	}
	out := map[string]any{"id": store.UUIDString(id)}
	if body.SharedWithFriends != nil {
		n, err := s.store.Queries.SetRideShared(r.Context(), db.SetRideSharedParams{
			Shared: *body.SharedWithFriends, ID: id, UserID: user.ID,
		})
		if !s.updated(w, n, err, "ride share failed") {
			return
		}
		out["sharedWithFriends"] = *body.SharedWithFriends
	}
	if body.Title != nil {
		n, err := s.store.Queries.SetRideTitle(r.Context(), db.SetRideTitleParams{
			Title: title, ID: id, UserID: user.ID,
		})
		if !s.updated(w, n, err, "ride title failed") {
			return
		}
		out["title"] = titleOf(title)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// updated answers an owner-scoped update that failed or touched no row, and
// reports whether the request may go on.
func (s *Service) updated(w http.ResponseWriter, n int64, err error, logMsg string) bool {
	if err != nil {
		httpx.Fail(w, s.log, logMsg, err, "The ride could not be updated.")
		return false
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return false
	}
	return true
}

// titleOf is the rider's name for a ride, or "" where they gave none.
func titleOf(title *string) string {
	if title == nil {
		return ""
	}
	return *title
}
