package crews

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Planned sessions' shared shapes (#116): the crew's schedule, Home's list
// across crews, and the boundary check every plan passes.

type scheduledJSON struct {
	ID          string `json:"id"`
	WorkoutName string `json:"workoutName"`
	WorkoutJSON string `json:"workoutJson"`
	StartsAt    string `json:"startsAt"` // RFC 3339
	CreatedBy   string `json:"createdBy"`
	// Who said they are in (#450), first to say so first. A plan with an
	// RSVP is what this repo calls an event — there is no second object.
	Going []riderJSON `json:"going,omitempty"`
	// How many said no, and how many have not answered (#1011). COUNTS, and
	// never names to the crew: the number is what changes a planner's
	// decision — hold the session or move it — and the names would only add
	// the pressure. Crews are small, so a list of who declined is close to
	// naming them out loud, which is a thing a crew does to a person rather
	// than a thing the software has to do for it.
	Out        int `json:"out,omitempty"`
	Unanswered int `json:"unanswered,omitempty"`
	// The same two, by name, for the plan's organiser only (#2797): whoever
	// may move or cancel it — its planner, the crew's owner and admins. They
	// are the ones who chase an answer or call the session off, and a count
	// cannot tell them whom to ask. Absent for everyone else, so a name
	// withheld is never on the wire.
	OutRiders        []riderJSON `json:"outRiders,omitempty"`
	UnansweredRiders []riderJSON `json:"unansweredRiders,omitempty"`
	// The caller's own answer — "in", "out", or absent for not yet asked.
	// Read rather than derived from Going: that list is the crew's public
	// half and would only ever answer half the question.
	YourAnswer string `json:"yourAnswer,omitempty"`
	// The crew's plans (#2440): the voice channel it names, absent while it
	// names none, and whether the caller planned it — a member moves and
	// cancels their own, so the page offers exactly those.
	ChannelID   string `json:"channelId,omitempty"`
	ChannelName string `json:"channelName,omitempty"`
	Mine        bool   `json:"mine,omitempty"`
}

type riderJSON struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

// rsvpWord is an answer as the wire and the screen spell it — docs/SPEC.md's
// glossary words, so no surface invents a synonym for "in" or "out".
func rsvpWord(going bool) string {
	if going {
		return "in"
	}
	return "out"
}

// plannedJSON is a planned session seen from outside its crew — Home lists
// every crew at once (ADR-0020), so each row carries its own.
//
// Deliberately not scheduledJSON (#1693). That struct carries the RSVPs and
// the workout, and both stay on the crew's schedule: `going` was declared here and never
// populated, so a rider read "nobody has said yes" off a field this route does
// not fill, and the workout JSON was a kilobyte a row — up to
// maxCalendarEvents of them — that no cross-crew list ever renders. The
// length is what a rider reads at a glance, so the length is what ships.
type plannedJSON struct {
	ID          string `json:"id"`
	WorkoutName string `json:"workoutName"`
	Minutes     int    `json:"minutes"`
	StartsAt    string `json:"startsAt"` // RFC 3339
	CreatedBy   string `json:"createdBy"`
	// The crew it is on and the voice channel it names (#2440) — the
	// channel absent while it names none.
	CrewID      string `json:"crewId"`
	CrewName    string `json:"crewName"`
	ChannelID   string `json:"channelId,omitempty"`
	ChannelName string `json:"channelName,omitempty"`
}

// handleMySchedule is the cross-crew planning surface (#325, #2440):
// everything you can ride in every crew you are in, plus the feed token.
// Home's "What's next" is what renders it (ADR-0020, ADR-0021 amended) — one
// row per planned session.
func (s *Service) handleMySchedule(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListUserCrewPlans(r.Context(), db.ListUserCrewPlansParams{
		// The same 30-minute grace the crew's own list keeps: a session stays
		// startable a little past its time. The far edge and the row bound are
		// the feeds' (#1414) — Home builds the same list in memory, and
		// planning stops three months out, so neither can hide a plan.
		UserID:      user.ID,
		StartsFrom:  pgTime(time.Now().Add(-30 * time.Minute)),
		StartsUntil: calendarUntil(), RowLimit: maxCalendarEvents,
	})
	if err != nil {
		httpx.Fail(w, s.log, "schedule list failed", err, "Your planned sessions could not be loaded. Try again.", "user", store.UUIDString(user.ID))
		return
	}
	s.warnIfTruncated(len(rows), "home", "user", store.UUIDString(user.ID))
	sessions := make([]plannedJSON, 0, len(rows))
	for _, row := range rows {
		entry := plannedJSON{
			ID: store.UUIDString(row.ID), WorkoutName: row.WorkoutName,
			Minutes:  workoutMinutes(string(row.WorkoutJson)),
			StartsAt: row.StartsAt.Time.Format(time.RFC3339), CreatedBy: row.CreatedBy,
			CrewID: store.UUIDString(row.CrewID), CrewName: row.CrewName,
		}
		if row.ChannelID.Valid {
			entry.ChannelID, entry.ChannelName = store.UUIDString(row.ChannelID), row.ChannelName
		}
		sessions = append(sessions, entry)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"sessions": sessions, "icsToken": user.IcsToken,
	})
}

// rsvpAnswer reads the answer an RSVP carries: `{"going": false}` declines,
// and an absent body or field is "in" — the spelling the app used before
// declines existed, so a tab loaded before a deploy keeps working. A DELETE
// carries none; the caller reads it as taking the answer back.
func rsvpAnswer(w http.ResponseWriter, r *http.Request) (going, ok bool) {
	if r.Method == http.MethodDelete {
		return true, true
	}
	var req struct {
		Going *bool `json:"going"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil && !errors.Is(err, io.EOF) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return false, false
	}
	return req.Going == nil || *req.Going, true
}

// checkPlan is a plan's boundary check (#2440):
// the name trimmed on the way through, or the field error written and false.
func checkPlan(w http.ResponseWriter, name, workoutJSON string, startsAt time.Time) (string, bool) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 || hasControl(name) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A workout name has to be 1-80 characters on one line.", "workoutName")
		return "", false
	}
	if segments, err := workout.Parse(workoutJSON); err != nil || len(segments) == 0 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a workout the engine can ride.", "workoutJson")
		return "", false
	}
	// The editor's bounds too (audit 2026-09-09); the message names the step.
	if err := workout.Validate(workoutJSON); err != nil {
		message, ok := workout.RefusalMessage(err)
		if !ok {
			message = "That is not a workout the engine can ride."
		}
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", message, "workoutJson")
		return "", false
	}
	if !plannableAt(startsAt) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A session is planned between now and three months out.", "startsAt")
		return "", false
	}
	return name, true
}

// plannableAt bounds both planning and moving a session.
func plannableAt(t time.Time) bool {
	now := time.Now()
	return !t.Before(now.Add(-time.Minute)) && !t.After(now.AddDate(0, 3, 0))
}

func pgTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
