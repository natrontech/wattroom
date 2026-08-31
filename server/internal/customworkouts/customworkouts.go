// Package customworkouts is the rider's own workout shelf (#15's deferred
// half): the editor saves here instead of localStorage, so a workout built
// on the desktop exists on the laptop. The curated library stays in the web
// bundle — it is code, reviewed and versioned with the app.
package customworkouts

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// UserSource resolves the signed-in user — same shape rooms consumes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

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
	if name == "" || len(name) > 80 {
		return "validation_error", "A workout name has to be 1-80 characters.", "name"
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
	rows, err := s.store.Queries.ListUserWorkouts(r.Context(), user.ID)
	if err != nil {
		s.log.Error("list workouts failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your workouts could not be loaded.")
		return
	}
	out := make([]workoutJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, workoutJSON{
			ID: store.UUIDString(row.ID), Workout: row.Definition,
			SavedAt: row.CreatedAt.Time.UnixMilli(),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"workouts": out})
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
	row, err := s.store.Queries.CreateWorkout(r.Context(), db.CreateWorkoutParams{
		OwnerID: user.ID, Name: name, Author: user.DisplayName, Definition: req.Workout,
	})
	if err != nil {
		s.log.Error("create workout failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The workout could not be saved. Try again.")
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
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That workout does not exist.")
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
		s.log.Error("delete workout failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The workout could not be deleted. Try again.")
		return
	}
	if rows == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That workout does not exist.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
