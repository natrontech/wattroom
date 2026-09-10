// Package customworkouts is the rider's own workout shelf (#15's deferred
// half): the editor saves here instead of localStorage, so a workout built
// on the desktop exists on the laptop. The curated library stays in the web
// bundle — it is code, reviewed and versioned with the app.
package customworkouts

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// UserSource resolves the signed-in user — same shape rooms consumes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// maxWorkoutsPerAccount is docs/SPEC.md's shelf ceiling; listPage is how much
// of the shelf one read returns (#1414). The two are deliberately independent:
// the read stays paged even though the whole ceiling would fit in two pages,
// because an account that predates the ceiling still holds whatever it holds
// and has to be able to reach all of it. Trusting a cap to keep a read small
// is exactly how `limit 1000` came to hide workout 1001 with nothing said.
const (
	maxWorkoutsPerAccount = 200
	listPage              = 100
)

type Service struct {
	store *store.Store
	users UserSource
	log   *slog.Logger
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/workouts", s.handleList)
	mux.HandleFunc("POST /api/workouts", s.handleCreate)
	mux.HandleFunc("PUT /api/workouts/{id}", s.handleUpdate)
	mux.HandleFunc("DELETE /api/workouts/{id}", s.handleDelete)
}

type workoutJSON struct {
	ID string `json:"id"`
	// The docs/SPEC.md workout JSON, opaque to the server beyond validation.
	Workout json.RawMessage `json:"workout"`
	SavedAt int64           `json:"savedAt"` // ms epoch, newest-first ordering
}

// checkDefinition bounds untrusted input the way the WS layer does: the
// deep shape check lives client-side in validateWorkout, the server proves
// the JSON runs through the same engine the ride does and stays sane.
func checkDefinition(name string, raw json.RawMessage) (code, message, field string) {
	// Engine first: junk that is not a workout at all should say so, not
	// complain about a name it could not read.
	segments, err := workout.Parse(string(raw))
	if err != nil || len(segments) == 0 {
		return "validation_error", "That is not a workout the engine can ride.", "workout"
	}
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return "validation_error", "A workout name has to be 1-80 characters.", "name"
	}
	// Then the editor's own bounds, so the API cannot store what the shelf
	// will refuse to read. Validate's error is written for the rider.
	if err := workout.Validate(string(raw)); err != nil {
		if msg, ok := workout.RefusalMessage(err); ok {
			return "validation_error", msg, "workout"
		}
		return "validation_error", "That is not a workout the engine can ride.", "workout"
	}
	total := 0
	for _, segment := range segments {
		total += segment.Seconds
	}
	if total <= 0 || total > 24*60*60 {
		return "validation_error", "A workout runs between a second and a day.", "workout"
	}
	return "", "", ""
}

type saveRequest struct {
	Workout json.RawMessage `json:"workout"`
}

func nameOf(raw json.RawMessage) string {
	var d struct {
		Name string `json:"name"`
	}
	_ = json.Unmarshal(raw, &d)
	return strings.TrimSpace(d.Name)
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	params := db.ListUserWorkoutsParams{OwnerID: user.ID, Limit: listPage}
	// The cursor is the previous page's last row, handed back verbatim: a
	// time (`before`, the rides list's name for it) and the id that breaks
	// its tie. Both or neither — half a cursor would page from a time with no
	// tie-break and step over the rows sharing it.
	before, beforeID := r.URL.Query().Get("before"), r.URL.Query().Get("beforeId")
	if (before == "") != (beforeID == "") {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"before and beforeId are one cursor — send the pair this list gave you, or neither.")
		return
	}
	if before != "" {
		at, err := time.Parse(time.RFC3339, before)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "before must be an RFC 3339 time.")
			return
		}
		id, err := store.ParseUUID(beforeID)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", "beforeId must be a workout id.")
			return
		}
		params.Before, params.BeforeID = pgtype.Timestamptz{Time: at, Valid: true}, id
	}
	rows, err := s.store.Queries.ListUserWorkouts(r.Context(), params)
	if err != nil {
		httpx.Fail(w, s.log, "list workouts failed", err, "Your workouts could not be loaded.")
		return
	}
	out := make([]workoutJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, workoutJSON{
			ID: store.UUIDString(row.ID), Workout: row.Definition,
			SavedAt: row.CreatedAt.Time.UnixMilli(),
		})
	}
	// A full page means there may be more, and the cursor comes from the
	// server rather than from the rider's own `savedAt`: that field is
	// milliseconds where created_at is microseconds, and a cursor rounded down
	// by a fraction of a millisecond steps over every row inside it. Silent
	// skipping is the bug being fixed here, not one to reintroduce at the page
	// boundary.
	body := map[string]any{"workouts": out, "more": len(rows) == listPage}
	if len(rows) == listPage {
		last := rows[len(rows)-1]
		// UTC, so the cursor never carries a "+" that a caller has to
		// remember to percent-encode before handing it back.
		body["nextBefore"] = last.CreatedAt.Time.UTC().Format(time.RFC3339Nano)
		body["nextBeforeId"] = store.UUIDString(last.ID)
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req saveRequest
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	name := nameOf(req.Workout)
	if code, message, field := checkDefinition(name, req.Workout); code != "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, code, message, field)
		return
	}
	// docs/SPEC.md's shelf ceiling. Counted with the rider's row locked, in
	// the transaction that inserts (#1413's lesson): a count followed by an
	// unsynchronised insert lets a burst past every one of them.
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "workout create begin failed", err, "The workout could not be saved. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(r.Context(), user.ID); err != nil {
		httpx.Fail(w, s.log, "workout create lock failed", err, "The workout could not be saved. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	held, err := q.CountUserWorkouts(r.Context(), user.ID)
	if err != nil {
		// Closed, not open: a count that failed must not wave the cap through.
		httpx.Fail(w, s.log, "workout count failed", err, "The workout could not be saved. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	if held >= maxWorkoutsPerAccount {
		// A per-account ceiling is a 429 (errors.md), like the ten-token cap.
		// Worded as a ceiling rather than a wait: nothing here clears on its
		// own, so "try again in a minute" would be a lie, and the one move
		// that works is named instead.
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			fmt.Sprintf("You have %d saved workouts, the most an account can hold. Delete one to make room.", maxWorkoutsPerAccount))
		return
	}
	row, err := q.CreateWorkout(r.Context(), db.CreateWorkoutParams{
		OwnerID: user.ID, Name: name, Author: user.DisplayName, Definition: req.Workout,
	})
	if err != nil {
		httpx.Fail(w, s.log, "create workout failed", err, "The workout could not be saved. Try again.")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Fail(w, s.log, "workout create commit failed", err, "The workout could not be saved. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, workoutJSON{
		ID: store.UUIDString(row.ID), Workout: row.Definition,
		SavedAt: row.CreatedAt.Time.UnixMilli(),
	})
}

func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That workout does not exist.")
		return
	}
	var req saveRequest
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	name := nameOf(req.Workout)
	if code, message, field := checkDefinition(name, req.Workout); code != "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, code, message, field)
		return
	}
	// owner_id in the WHERE is the authorization: someone else's id is a 404,
	// indistinguishable from absent — no probing which ids exist.
	row, err := s.store.Queries.UpdateWorkout(r.Context(), db.UpdateWorkoutParams{
		ID: id, OwnerID: user.ID, Name: name, Author: user.DisplayName, Definition: req.Workout,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That workout does not exist.")
		return
	}
	if err != nil {
		// Like create and delete: a database failure is logged and a 500, not
		// a rider told their workout does not exist (audit 2026-09-09).
		httpx.Fail(w, s.log, "workout update failed", err, "The workout could not be saved. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, workoutJSON{
		ID: store.UUIDString(row.ID), Workout: row.Definition,
		SavedAt: row.CreatedAt.Time.UnixMilli(),
	})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That workout does not exist.")
		return
	}
	rows, err := s.store.Queries.DeleteWorkout(r.Context(), db.DeleteWorkoutParams{ID: id, OwnerID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "delete workout failed", err, "The workout could not be deleted. Try again.")
		return
	}
	if rows == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That workout does not exist.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
