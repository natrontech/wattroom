package rooms

import (
	"crypto/subtle"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// iCal feeds for planned sessions (#245, #325). Calendar apps can't sign in,
// so the URL carries a secret token — the same "private address" pattern
// Google Calendar uses; the holder rotates it when it leaks.
//
// Two feeds, two subjects. The room feed is a room's schedule, shareable with
// people who aren't members. The rider feed is every room you ride in, and is
// the one the UI offers first: four rooms used to mean four subscriptions.

// icsEvent is what both feeds agree on — the row types differ, the calendar
// entry doesn't.
type icsEvent struct {
	id       string
	stamp    time.Time
	start    time.Time
	length   time.Duration
	summary  string
	planner  string
	roomName string
	roomSlug string
}

func (s *Service) handleCalendar(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	token := icsPathToken(r)
	if subtle.ConstantTimeCompare([]byte(token), []byte(room.IcsToken)) != 1 {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That calendar link is not valid — ask in the room for the current one.")
		return
	}
	rows, err := s.store.Queries.ListRoomCalendar(r.Context(), room.ID)
	if err != nil {
		s.log.Error("calendar feed failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The calendar could not be loaded. Try again.")
		return
	}
	events := make([]icsEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, icsEvent{
			id: store.UUIDString(row.ID), stamp: row.CreatedAt.Time, start: row.StartsAt.Time,
			length: workoutLength(string(row.WorkoutJson)), summary: row.WorkoutName,
			planner: row.CreatedBy, roomName: room.Name, roomSlug: room.Slug,
		})
	}
	writeICS(w, room.Name+" · WattRoom", r.Host, events)
}

// handleUserCalendar is the rider-addressed feed (#325): one subscription
// that follows your membership list instead of a single room.
func (s *Service) handleUserCalendar(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.Queries.GetUserByIcsToken(r.Context(), icsPathToken(r))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That calendar link is not valid — copy the current one from your sessions page.")
		return
	}
	rows, err := s.store.Queries.ListUserCalendar(r.Context(), db.ListUserCalendarParams{
		UserID: user.ID, StartsAt: pgTime(time.Now().AddDate(0, 0, -30)),
	})
	if err != nil {
		s.log.Error("rider calendar feed failed", "err", err, "user", store.UUIDString(user.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The calendar could not be loaded. Try again.")
		return
	}
	events := make([]icsEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, icsEvent{
			id: store.UUIDString(row.ID), stamp: row.CreatedAt.Time, start: row.StartsAt.Time,
			length: workoutLength(string(row.WorkoutJson)), summary: row.WorkoutName,
			planner: row.CreatedBy, roomName: row.RoomName, roomSlug: row.RoomSlug,
		})
	}
	writeICS(w, "WattRoom sessions", r.Host, events)
}

// handleRotateIcs is the leak escape hatch: owner-only, old feed URLs die on
// the spot, every subscriber re-adds the new one.
func (s *Service) handleRotateIcs(w http.ResponseWriter, r *http.Request) {
	room, _, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	token, err := s.store.Queries.RotateRoomIcsToken(r.Context(), room.ID)
	if err != nil {
		s.log.Error("ics rotate failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The calendar link could not be reset. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"icsToken": token})
}

// handleRotateUserIcs is the same escape hatch for your own feed.
func (s *Service) handleRotateUserIcs(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	token, err := s.store.Queries.RotateUserIcsToken(r.Context(), user.ID)
	if err != nil {
		s.log.Error("rider ics rotate failed", "err", err, "user", store.UUIDString(user.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The calendar link could not be reset. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"icsToken": token})
}

// icsPathToken reads the token out of the URL. The .ics suffix is what makes
// calendar apps accept the link at all.
func icsPathToken(r *http.Request) string {
	return strings.TrimSuffix(r.PathValue("token"), ".ics")
}

func writeICS(w http.ResponseWriter, calName, host string, events []icsEvent) {
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	_, _ = io.WriteString(w, buildICS(calName, host, events))
}

func buildICS(calName, host string, events []icsEvent) string {
	var b strings.Builder
	fmt.Fprintf(&b, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"+
		"PRODID:-//WattRoom//planned sessions//EN\r\nCALSCALE:GREGORIAN\r\n"+
		"METHOD:PUBLISH\r\nX-WR-CALNAME:%s\r\n", icsEscape(calName))
	for _, e := range events {
		fmt.Fprintf(&b, "BEGIN:VEVENT\r\nUID:%s@wattroom\r\nDTSTAMP:%s\r\n"+
			"DTSTART:%s\r\nDTEND:%s\r\nSUMMARY:%s\r\nDESCRIPTION:%s\r\n"+
			"LOCATION:%s\r\nURL:https://%s/r/%s\r\nEND:VEVENT\r\n",
			e.id, icsTime(e.stamp), icsTime(e.start), icsTime(e.start.Add(e.length)),
			icsEscape(e.summary),
			icsEscape("Planned by "+e.planner+" in "+e.roomName+"."),
			icsEscape(e.roomName), host, e.roomSlug)
	}
	b.WriteString("END:VCALENDAR\r\n")
	return b.String()
}

// workoutLength sums the flattened timeline; segments are sequential, so the
// last one ends the ride.
func workoutLength(workoutJSON string) time.Duration {
	segments, err := workout.Parse(workoutJSON)
	if err != nil || len(segments) == 0 {
		return 30 * time.Minute // an unreadable plan still blocks out time
	}
	last := segments[len(segments)-1]
	return time.Duration(last.Start+last.Seconds) * time.Second
}

// icsTime is RFC 5545's UTC basic format.
func icsTime(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

// icsEscape is RFC 5545 TEXT escaping. ponytail: no 75-octet line folding —
// names cap at 80 chars and every major client parses unfolded lines.
func icsEscape(s string) string {
	return strings.NewReplacer(
		`\`, `\\`, ";", `\;`, ",", `\,`, "\n", `\n`, "\r", "",
	).Replace(s)
}
