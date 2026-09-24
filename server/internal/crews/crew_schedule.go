package crews

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The crew's schedule (#2440, ADR-0058): one calendar for the crew, a plan
// naming the voice channel it will run in or none yet. docs/SPEC.md's roles
// matrix: any member plans and says they are in; the owner and admins move
// and cancel any plan, a member their own; any member who may enter the
// channel starts one. A plan naming a private channel is that channel's —
// to anyone else it does not exist.

// maxPlannedPerCrew is docs/SPEC.md's shelf ceiling, counted the way the
// crew's own schedule counts: upcoming and not yet started.
const maxPlannedPerCrew = 100

func (s *Service) registerCrewSchedule(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crews/{id}/schedule", s.handleCrewSchedule)
	mux.HandleFunc("POST /api/crews/{id}/schedule", s.handleCrewPlan)
	mux.HandleFunc("PATCH /api/crews/{id}/schedule/{plan}", s.handleCrewMove)
	mux.HandleFunc("DELETE /api/crews/{id}/schedule/{plan}", s.handleCrewCancel)
	mux.HandleFunc("PUT /api/crews/{id}/schedule/{plan}/rsvp", s.handleCrewRsvp)
	mux.HandleFunc("DELETE /api/crews/{id}/schedule/{plan}/rsvp", s.handleCrewRsvp)
	mux.HandleFunc("POST /api/crews/{id}/schedule/{plan}/started", s.handleCrewStarted)
	mux.HandleFunc("GET /api/crews/{id}/calendar/{token}", s.handleCrewCalendar)
	mux.HandleFunc("POST /api/crews/{id}/calendar/rotate", s.handleRotateCrewIcs)
}

// tallyAnswers splits the RSVPs the way every schedule shows them (#1011): an
// "in" is named, an "out" is a number, and the caller's own answer is theirs.
func tallyAnswers(me pgtype.UUID, answers []db.ListCrewRsvpsRow) (going map[string][]goingJSON, out map[string]int, yours map[string]string) {
	going, out, yours = map[string][]goingJSON{}, map[string]int{}, map[string]string{}
	for _, row := range answers {
		id := store.UUIDString(row.SessionID)
		if row.UserID == me {
			yours[id] = rsvpWord(row.Going)
		}
		if !row.Going {
			out[id]++
			continue
		}
		going[id] = append(going[id], goingJSON{ID: store.UUIDString(row.UserID), DisplayName: row.DisplayName})
	}
	return going, out, yours
}

// handleCrewSchedule is the crew's calendar as the caller may see it.
func (s *Service) handleCrewSchedule(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewUpcoming(r.Context(), db.ListCrewUpcomingParams{CrewID: crew.ID, Viewer: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "list crew schedule failed", err, "The schedule could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	answers, err := s.store.Queries.ListCrewRsvps(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list crew rsvps failed", err, "The schedule could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	going, out, yours := tallyAnswers(user.ID, answers)
	sessions := make([]scheduledJSON, 0, len(rows))
	for _, row := range rows {
		id := store.UUIDString(row.ID)
		entry := scheduledJSON{
			ID: id, WorkoutName: row.WorkoutName, WorkoutJSON: string(row.WorkoutJson),
			StartsAt: row.StartsAt.Time.Format(time.RFC3339), CreatedBy: row.CreatedBy,
			Going: going[id], Out: out[id], YourAnswer: yours[id],
			// Never below zero: someone can answer and leave between reads.
			Unanswered: max(0, int(row.Audience)-len(going[id])-out[id]),
			Mine:       row.CreatedByID == user.ID,
		}
		if row.ChannelID.Valid {
			entry.ChannelID, entry.ChannelName = store.UUIDString(row.ChannelID), row.ChannelName
		}
		sessions = append(sessions, entry)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

// enterableChannel resolves a plan's channel from the request: "" is none,
// and anything else must be a voice channel of this crew the caller may
// enter — answered as a field error, since it is a pick in a form.
func (s *Service) enterableChannel(w http.ResponseWriter, r *http.Request, crew, viewer pgtype.UUID, raw string) (pgtype.UUID, bool) {
	if raw == "" {
		return pgtype.UUID{}, true
	}
	if id, err := store.ParseUUID(raw); err == nil {
		channel, err := s.store.Queries.GetEnterableVoiceChannel(r.Context(), db.GetEnterableVoiceChannelParams{
			ID: id, CrewID: crew, Viewer: viewer,
		})
		if err == nil {
			return channel.ID, true
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "plan channel lookup failed", err, "That could not be saved. Try again.", "crew", store.UUIDString(crew))
			return pgtype.UUID{}, false
		}
	}
	httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
		"Pick one of this crew's voice channels.", "channelId")
	return pgtype.UUID{}, false
}

func (s *Service) handleCrewPlan(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	var req struct {
		WorkoutName string    `json:"workoutName"`
		WorkoutJSON string    `json:"workoutJson"`
		StartsAt    time.Time `json:"startsAt"`
		ChannelID   string    `json:"channelId"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	name, valid := checkPlan(w, req.WorkoutName, req.WorkoutJSON, req.StartsAt)
	if !valid {
		return
	}
	channel, ok := s.enterableChannel(w, r, crew.ID, user.ID, req.ChannelID)
	if !ok {
		return
	}
	crewID := store.UUIDString(crew.ID)
	// The shelf counted with the crew's row locked, in the transaction that
	// inserts (#1413): a count and an insert apart are a ceiling a burst
	// walks through. The planner's row first, then the crew's: users before
	// crews, the one lock order in this app.
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "plan begin failed", err, "The session could not be planned. Try again.", "crew", crewID)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(r.Context(), user.ID); err != nil {
		httpx.Fail(w, s.log, "plan lock failed", err, "The session could not be planned. Try again.", "crew", crewID)
		return
	}
	if err := q.LockCrew(r.Context(), crew.ID); err != nil {
		httpx.Fail(w, s.log, "plan lock failed", err, "The session could not be planned. Try again.", "crew", crewID)
		return
	}
	planned, err := q.CountCrewUpcoming(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "planned session count failed", err, "The session could not be planned. Try again.", "crew", crewID)
		return
	}
	if planned >= maxPlannedPerCrew {
		httpx.WriteCeiling(w, fmt.Sprintf(
			"This crew has %d sessions planned, the most it can hold. Cancel one, or wait for the next to start, to plan another.",
			maxPlannedPerCrew))
		return
	}
	row, err := q.CreateCrewPlan(r.Context(), db.CreateCrewPlanParams{
		CrewID: crew.ID, ChannelID: channel, WorkoutName: name, WorkoutJson: []byte(req.WorkoutJSON),
		StartsAt: pgTime(req.StartsAt), CreatedBy: user.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "plan failed", err, "The session could not be planned. Try again.", "crew", crewID)
		return
	}
	// Nothing below is undoable — a mail goes out, a line lands on the
	// timeline — so the row is committed before any of it runs.
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Fail(w, s.log, "plan commit failed", err, "The session could not be planned. Try again.", "crew", crewID)
		return
	}
	if s.notifier != nil {
		s.notifier.SessionPlanned(crew.ID, channel, name, req.StartsAt, user.ID)
	}
	s.announceIn(channel, "planned", user.DisplayName, name, req.StartsAt)
	out := scheduledJSON{
		ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName, WorkoutJSON: string(row.WorkoutJson),
		StartsAt: row.StartsAt.Time.Format(time.RFC3339), CreatedBy: user.DisplayName, Mine: true,
	}
	if channel.Valid {
		out.ChannelID = store.UUIDString(channel)
	}
	httpx.WriteJSON(w, http.StatusCreated, out)
}

// announceIn is announce for a crew's plan (#359, #570): the line lands on
// the timeline of the channel the plan names, and the lobby ping is what
// makes every schedule on screen re-fetch.
func (s *Service) announceIn(channel pgtype.UUID, verb, actor, workout string, startsAt time.Time) {
	if s.presence == nil {
		return
	}
	if channel.Valid {
		s.presence.SessionAnnounce(store.UUIDString(channel), verb, actor, workout, startsAt)
	}
	s.presence.PresenceChanged()
}

// crewPlan is the plan in the URL, if the caller may see it.
func (s *Service) crewPlan(w http.ResponseWriter, r *http.Request, crew, viewer pgtype.UUID) (db.GetCrewPlanRow, bool) {
	id, err := store.ParseUUID(r.PathValue("plan"))
	if err == nil {
		var plan db.GetCrewPlanRow
		plan, err = s.store.Queries.GetCrewPlan(r.Context(), db.GetCrewPlanParams{ID: id, CrewID: crew, Viewer: viewer})
		if err == nil {
			return plan, true
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "plan lookup failed", err, "That could not be loaded. Try again.", "crew", store.UUIDString(crew))
			return db.GetCrewPlanRow{}, false
		}
	}
	httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned session does not exist.")
	return db.GetCrewPlanRow{}, false
}

// mayRearrange is the matrix's "move / cancel": the crew's owner and admins
// any plan, a member their own.
func mayRearrange(w http.ResponseWriter, role string, plan db.GetCrewPlanRow, user pgtype.UUID) bool {
	if administers(role) || plan.CreatedBy == user {
		return true
	}
	httpx.WriteError(w, http.StatusForbidden, "forbidden",
		"Only whoever planned it, or the crew's owner or an admin, can change this plan.")
	return false
}

func (s *Service) handleCrewMove(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
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
	plan, ok := s.crewPlan(w, r, crew.ID, user.ID)
	if !ok || !mayRearrange(w, role, plan, user.ID) {
		return
	}
	if _, err := s.store.Queries.MoveCrewPlan(r.Context(), db.MoveCrewPlanParams{
		ID: plan.ID, CrewID: crew.ID, StartsAt: pgTime(req.StartsAt),
	}); errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned session does not exist.")
		return
	} else if err != nil {
		httpx.Fail(w, s.log, "move plan failed", err, "The plan could not be moved. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	// A move to the time it had is not a move (#1639): no mail, no line, and
	// the declines stand. A real one asks the decliners again (#1011).
	if !plan.StartsAt.Time.Equal(req.StartsAt) {
		if err := s.store.Queries.ClearSessionDeclines(r.Context(), plan.ID); err != nil {
			s.log.Warn("clearing declines after a move failed", "err", err, "session", store.UUIDString(plan.ID))
		}
		if s.notifier != nil {
			s.notifier.SessionRescheduled(crew.ID, plan.ChannelID, plan.WorkoutName, req.StartsAt, user.ID)
		}
		s.announceIn(plan.ChannelID, "moved", user.DisplayName, plan.WorkoutName, req.StartsAt)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleCrewCancel(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	plan, ok := s.crewPlan(w, r, crew.ID, user.ID)
	if !ok || !mayRearrange(w, role, plan, user.ID) {
		return
	}
	row, err := s.store.Queries.DeleteCrewPlan(r.Context(), db.DeleteCrewPlanParams{ID: plan.ID, CrewID: crew.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That planned session does not exist.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "cancel plan failed", err, "The plan could not be removed. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	// A session already been and gone is not news (#839).
	if s.notifier != nil && row.StartsAt.Time.After(time.Now()) {
		s.notifier.SessionCancelled(crew.ID, row.ChannelID, row.WorkoutName, row.StartsAt.Time, user.ID)
	}
	s.announceIn(row.ChannelID, "cancelled", user.DisplayName, row.WorkoutName, time.Time{})
	w.WriteHeader(http.StatusNoContent)
}

// handleCrewRsvp is handleRsvp for the crew's plans: PUT writes the answer —
// `{"going": false}` to decline, no body for "in" — and DELETE takes it back.
func (s *Service) handleCrewRsvp(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	going, ok := rsvpAnswer(w, r)
	if !ok {
		return
	}
	plan, ok := s.crewPlan(w, r, crew.ID, user.ID)
	if !ok {
		return
	}
	var err error
	if r.Method == http.MethodDelete {
		err = s.store.Queries.ClearRsvp(r.Context(), db.ClearRsvpParams{SessionID: plan.ID, UserID: user.ID})
	} else {
		err = s.store.Queries.SetRsvp(r.Context(), db.SetRsvpParams{SessionID: plan.ID, UserID: user.ID, Going: going})
	}
	if err != nil {
		httpx.Fail(w, s.log, "rsvp failed", err, "That could not be saved. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleCrewStarted starts a plan (#2440): it opens the session in the voice
// channel the plan names — or the one the body names, for a plan that named
// none — with the caller as its coach, then marks the plan started, once.
// The channel's one-session rule is the hub's to answer (#2438), so a plan
// started while another session runs there is refused naming that coach.
func (s *Service) handleCrewStarted(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	var req struct {
		ChannelID string `json:"channelId"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil && !errors.Is(err, io.EOF) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	plan, ok := s.crewPlan(w, r, crew.ID, user.ID)
	if !ok {
		return
	}
	if plan.StartedAt.Valid {
		httpx.WriteError(w, http.StatusConflict, "conflict", "That planned session was already started.")
		return
	}
	channel := plan.ChannelID
	if !channel.Valid {
		if req.ChannelID == "" {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"This plan names no voice channel yet. Pick the one it runs in.", "channelId")
			return
		}
		if channel, ok = s.enterableChannel(w, r, crew.ID, user.ID, req.ChannelID); !ok {
			return
		}
	}
	var sessionID string
	if s.presence != nil {
		rider := protocol.Rider{ID: store.UUIDString(user.ID), Name: user.DisplayName, Role: role}
		id, code, message := s.presence.OpenSession(store.UUIDString(channel), rider, plan.WorkoutName, string(plan.WorkoutJson))
		if code != "" {
			status := http.StatusBadRequest
			if code == "conflict" {
				status = http.StatusConflict
			}
			httpx.WriteError(w, status, code, message)
			return
		}
		sessionID = id
	}
	n, err := s.store.Queries.StartCrewPlan(r.Context(), db.StartCrewPlanParams{ID: plan.ID, CrewID: crew.ID, ChannelID: channel})
	if err != nil {
		httpx.Fail(w, s.log, "start plan failed", err, "That could not be saved. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusConflict, "conflict", "That planned session was already started.")
		return
	}
	// The plan leaves every schedule on screen; the session's own start is
	// what the channel's timeline says, on the tick.
	if s.presence != nil {
		s.presence.PresenceChanged()
	}
	// The session's id too (#2599): the starter goes to the ride, not to the
	// channel's lobby with the count-in already running.
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"channelId": store.UUIDString(channel), "sessionId": sessionID})
}
