package rooms

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Planned rides (#116). The roles matrix gives session-running to coach and
// owner alike — scheduling is running a session early.

type scheduledJSON struct {
	ID          string `json:"id"`
	WorkoutName string `json:"workoutName"`
	WorkoutJSON string `json:"workoutJson"`
	StartsAt    string `json:"startsAt"` // RFC 3339
	CreatedBy   string `json:"createdBy"`
}

// plannedJSON is a scheduled session seen from outside its room — the
// /sessions page lists every room at once, so each row carries its own.
type plannedJSON struct {
	scheduledJSON
	RoomSlug   string `json:"roomSlug"`
	RoomName   string `json:"roomName"`
	CanControl bool   `json:"canControl"`
}

// handleMySchedule is the cross-room planning surface (#325): everything you
// can ride, plus the feed token that subscribes to exactly this list.
func (s *Service) handleMySchedule(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListUserCalendar(r.Context(), db.ListUserCalendarParams{
		// The same 30-minute grace the in-room list keeps: a session stays
		// startable a little past its time.
		UserID: user.ID, StartsAt: pgTime(time.Now().Add(-30 * time.Minute)),
	})
	if err != nil {
		s.log.Error("schedule list failed", "err", err, "user", store.UUIDString(user.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your planned sessions could not be loaded. Try again.")
		return
	}
	sessions := make([]plannedJSON, 0, len(rows))
	for _, row := range rows {
		sessions = append(sessions, plannedJSON{
			scheduledJSON: scheduledJSON{
				ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
				WorkoutJSON: string(row.WorkoutJson),
				StartsAt:    row.StartsAt.Time.Format(time.RFC3339), CreatedBy: row.CreatedBy,
			},
			RoomSlug: row.RoomSlug, RoomName: row.RoomName,
			CanControl: row.YourRole == "owner" || row.YourRole == "coach",
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"sessions": sessions, "icsToken": user.IcsToken,
	})
}

// requireControl is requireRole for "coach or owner" — the pair the matrix
// hands the shared timeline to.
func (s *Service) requireControl(w http.ResponseWriter, r *http.Request) (db.Room, db.User, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.Room{}, db.User{}, false
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return db.Room{}, db.User{}, false
	}
	m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
		RoomID: room.ID, UserID: user.ID,
	})
	if err != nil || (m.Role != "owner" && m.Role != "coach") {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the room's coach or owner can plan a session.")
		return db.Room{}, db.User{}, false
	}
	return room, user, true
}

// announce puts one plan line on the room's live timeline (#359). Silent
// without a hub — planning still works, the room just hears about it when
// someone reloads.
func (s *Service) announce(room db.Room, verb, actor, workout string, startsAt time.Time) {
	if s.presence == nil {
		return
	}
	s.presence.SessionAnnounce(room.Slug, verb, actor, workout, startsAt)
}

func (s *Service) handleSchedule(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.requireControl(w, r)
	if !ok {
		return
	}
	var req struct {
		WorkoutName string    `json:"workoutName"`
		WorkoutJSON string    `json:"workoutJson"`
		StartsAt    time.Time `json:"startsAt"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.WorkoutName = strings.TrimSpace(req.WorkoutName)
	if req.WorkoutName == "" || len(req.WorkoutName) > 80 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A workout name has to be 1-80 characters.", "workoutName")
		return
	}
	if segments, err := workout.Parse(req.WorkoutJSON); err != nil || len(segments) == 0 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a workout the engine can ride.", "workoutJson")
		return
	}
	if !plannableAt(req.StartsAt) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A session is planned between now and three months out.", "startsAt")
		return
	}
	row, err := s.store.Queries.CreateScheduledSession(r.Context(), db.CreateScheduledSessionParams{
		RoomID: room.ID, WorkoutName: req.WorkoutName, WorkoutJson: []byte(req.WorkoutJSON),
		StartsAt: pgTime(req.StartsAt), CreatedBy: user.ID,
	})
	if err != nil {
		s.log.Error("schedule failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The session could not be planned. Try again.")
		return
	}
	if s.notifier != nil {
		s.notifier.SessionPlanned(room, req.WorkoutName, req.StartsAt, user.ID)
	}
	s.announce(room, "planned", user.DisplayName, req.WorkoutName, req.StartsAt)
	httpx.WriteJSON(w, http.StatusCreated, scheduledJSON{
		ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
		WorkoutJSON: string(row.WorkoutJson),
		StartsAt:    row.StartsAt.Time.Format(time.RFC3339), CreatedBy: user.DisplayName,
	})
}

// plannableAt bounds both planning and moving a session.
func plannableAt(t time.Time) bool {
	now := time.Now()
	return !t.Before(now.Add(-time.Minute)) && !t.After(now.AddDate(0, 3, 0))
}

func (s *Service) handleReschedule(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.requireControl(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned session does not exist.")
		return
	}
	var req struct {
		StartsAt time.Time `json:"startsAt"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if !plannableAt(req.StartsAt) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A session is planned between now and three months out.", "startsAt")
		return
	}
	row, err := s.store.Queries.RescheduleSession(r.Context(), db.RescheduleSessionParams{
		ID: id, RoomID: room.ID, StartsAt: pgTime(req.StartsAt),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned session does not exist.")
		return
	}
	if err != nil {
		s.log.Error("reschedule failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The plan could not be moved. Try again.")
		return
	}
	if s.notifier != nil {
		s.notifier.SessionRescheduled(room, row.WorkoutName, req.StartsAt, user.ID)
	}
	s.announce(room, "moved", user.DisplayName, row.WorkoutName, req.StartsAt)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleUnschedule(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.requireControl(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned session does not exist.")
		return
	}
	name, err := s.store.Queries.DeleteScheduledSession(r.Context(), db.DeleteScheduledSessionParams{
		ID: id, RoomID: room.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned session does not exist.")
		return
	}
	if err != nil {
		s.log.Error("unschedule failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The plan could not be removed. Try again.")
		return
	}
	s.announce(room, "cancelled", user.DisplayName, name, time.Time{})
	w.WriteHeader(http.StatusNoContent)
}

type nextJSON struct {
	WorkoutName string `json:"workoutName"`
	StartsAt    string `json:"startsAt"`
}

func pgTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
