// Package plans is the rider's own plan (#4615): a workout from their shelf
// on a day, seen by them alone. The crew schedule (internal/crews) is the
// plan a crew sees and is mailed about; this one mails nobody. Home reads
// today's, the Workouts page the week's, and an agent writes it over MCP.
package plans

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource resolves the signed-in user, the shape the shelf consumes.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// docs/spec/workouts.md "Your plan": the crew schedule's bounds (crew.md),
// three months out and 100 plans, so the two plans never disagree on how far
// ahead a rider can think. A read spans at most maxSpanDays.
const (
	maxUpcoming = 100
	maxSpanDays = 100
	dayLayout   = time.DateOnly
)

type Service struct {
	store *store.Store
	users UserSource
	log   *slog.Logger
	now   func() time.Time
}

func New(st *store.Store, users UserSource, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log, now: time.Now}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/plan", s.handleList)
	mux.HandleFunc("POST /api/plan", s.handleCreate)
	mux.HandleFunc("PUT /api/plan/{id}", s.handleMove)
	mux.HandleFunc("DELETE /api/plan/{id}", s.handleDelete)
}

// PlanJSON is one planned day as the wire spells it.
type PlanJSON struct {
	ID          string `json:"id"`
	Day         string `json:"day"` // YYYY-MM-DD, the rider's own date
	WorkoutID   string `json:"workoutId"`
	WorkoutName string `json:"workoutName"`
}

// window is the days a plan may land on. `day` is the rider's date and the
// server knows no zone, so the window reaches a day either side of the
// server's: a rider in UTC+14 is already a day ahead.
func (s *Service) window() (first, last time.Time) {
	today := s.now().UTC().Truncate(24 * time.Hour)
	return today.AddDate(0, 0, -1), today.AddDate(0, 3, 1)
}

func parseDay(raw string) (pgtype.Date, bool) {
	t, err := time.Parse(dayLayout, raw)
	if err != nil {
		return pgtype.Date{}, false
	}
	return pgtype.Date{Time: t, Valid: true}, true
}

func (s *Service) checkDay(w http.ResponseWriter, raw string) (pgtype.Date, bool) {
	day, ok := parseDay(raw)
	if !ok {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "A day is a date like 2026-11-19.", "day")
		return day, false
	}
	first, last := s.window()
	if day.Time.Before(first) || day.Time.After(last) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A ride is planned between today and three months out.", "day")
		return day, false
	}
	return day, true
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	from, okFrom := parseDay(r.URL.Query().Get("from"))
	to, okTo := parseDay(r.URL.Query().Get("to"))
	if !okFrom || !okTo || to.Time.Before(from.Time) || to.Time.Sub(from.Time) > maxSpanDays*24*time.Hour {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			fmt.Sprintf("Ask for from and to as dates like 2026-11-19, at most %d days apart.", maxSpanDays))
		return
	}
	plans, err := List(r.Context(), s.store.Queries, user.ID, from, to)
	if err != nil {
		httpx.Fail(w, s.log, "list plans failed", err, "Your plan could not be loaded.", "user", store.UUIDString(user.ID))
		return
	}
	out := make([]PlanJSON, 0, len(plans))
	for _, p := range plans {
		out = append(out, p.JSON())
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"plans": out})
}

// Plan is one row with the workout it names, for the API and for MCP.
type Plan struct {
	Row db.ListPersonalPlansRow
}

func (p Plan) JSON() PlanJSON {
	return PlanJSON{
		ID: store.UUIDString(p.Row.ID), Day: p.Row.Day.Time.Format(dayLayout),
		WorkoutID: store.UUIDString(p.Row.WorkoutID), WorkoutName: p.Row.WorkoutName,
	}
}

// List is one rider's plans from one day through another.
func List(ctx context.Context, q *db.Queries, user pgtype.UUID, from, to pgtype.Date) ([]Plan, error) {
	rows, err := q.ListPersonalPlans(ctx, db.ListPersonalPlansParams{UserID: user, FromDay: from, ToDay: to})
	if err != nil {
		return nil, fmt.Errorf("list personal plans: %w", err)
	}
	out := make([]Plan, 0, len(rows))
	for _, row := range rows {
		out = append(out, Plan{Row: row})
	}
	return out, nil
}

type createRequest struct {
	WorkoutID string `json:"workoutId"`
	Day       string `json:"day"`
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req createRequest
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	workoutID, err := store.ParseUUID(req.WorkoutID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "That workout is not on your shelf.", "workoutId")
		return
	}
	day, ok := s.checkDay(w, req.Day)
	if !ok {
		return
	}
	fail := func(what string, err error) {
		httpx.Fail(w, s.log, what, err, "The ride could not be planned. Try again.", "user", store.UUIDString(user.ID))
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		fail("plan create begin failed", err)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(r.Context(), user.ID); err != nil {
		fail("plan create lock failed", err)
		return
	}
	first, _ := s.window()
	held, err := q.CountUpcomingPersonalPlans(r.Context(), db.CountUpcomingPersonalPlansParams{
		UserID: user.ID, Day: pgtype.Date{Time: first, Valid: true},
	})
	if err != nil {
		fail("plan count failed", err)
		return
	}
	if held >= maxUpcoming {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			fmt.Sprintf("You have %d rides planned, the most a plan holds. Remove one to make room.", maxUpcoming))
		return
	}
	id, err := q.CreatePersonalPlan(r.Context(), db.CreatePersonalPlanParams{UserID: user.ID, Day: day, WorkoutID: workoutID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "That workout is not on your shelf.", "workoutId")
		return
	}
	if err != nil {
		fail("plan create failed", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		fail("plan create commit failed", err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"id": store.UUIDString(id), "day": day.Time.Format(dayLayout), "workoutId": store.UUIDString(workoutID),
	})
}

func (s *Service) handleMove(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned ride does not exist.")
		return
	}
	var req struct {
		Day string `json:"day"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	day, ok := s.checkDay(w, req.Day)
	if !ok {
		return
	}
	n, err := s.store.Queries.MovePersonalPlan(r.Context(), db.MovePersonalPlanParams{ID: id, UserID: user.ID, Day: day})
	if err != nil {
		httpx.Fail(w, s.log, "plan move failed", err, "The ride could not be moved. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned ride does not exist.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned ride does not exist.")
		return
	}
	n, err := s.store.Queries.DeletePersonalPlan(r.Context(), db.DeletePersonalPlanParams{ID: id, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "plan delete failed", err, "The ride could not be unplanned. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned ride does not exist.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
