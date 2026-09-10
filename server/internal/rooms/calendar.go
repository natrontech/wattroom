package rooms

import (
	"crypto/subtle"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

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

// The feeds' bounds, docs/SPEC.md (#1414). Both feeds render their whole
// result into one in-memory string per request, behind nothing but a bearer
// token in the URL, so "uncapped" made row growth into a memory spike anybody
// with the link could ask for. calendarHorizon is generous against
// plannableAt's three months, and maxCalendarEvents against the 50-session
// ceiling — twenty rooms' worth of full schedules — so a rider reaching
// either bound has hit something no product surface can produce.
const (
	calendarHistory   = 30 * 24 * time.Hour
	calendarHorizon   = 365 * 24 * time.Hour
	maxCalendarEvents = 1000
)

// calendarUntil is the far edge every calendar read shares — the feeds and
// the sessions page alike, so none of them can quietly disagree about how far
// ahead a plan is visible.
func calendarUntil() pgtype.Timestamptz { return pgTime(time.Now().Add(calendarHorizon)) }

// warnIfTruncated says so when a read came back exactly full. A row bound
// that silently drops plans is the failure this whole change is about
// (#1908, #1414) — nothing the product can produce reaches it, so if one
// ever does, the operator hears about it rather than a rider losing a
// session out of their calendar in silence.
func (s *Service) warnIfTruncated(rows int, feed string, args ...any) {
	if rows < maxCalendarEvents {
		return
	}
	s.log.Warn("calendar feed hit its row bound", append([]any{"feed", feed, "bound", maxCalendarEvents}, args...)...)
}

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
	rows, err := s.store.Queries.ListRoomCalendar(r.Context(), db.ListRoomCalendarParams{
		RoomID:      room.ID,
		StartsFrom:  pgTime(time.Now().Add(-calendarHistory)),
		StartsUntil: calendarUntil(), RowLimit: maxCalendarEvents,
	})
	if err != nil {
		httpx.Fail(w, s.log, "calendar feed failed", err, "The calendar could not be loaded. Try again.", "room", room.Slug)
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
	s.warnIfTruncated(len(rows), "room", "room", room.Slug)
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
		UserID:      user.ID,
		StartsFrom:  pgTime(time.Now().Add(-calendarHistory)),
		StartsUntil: calendarUntil(), RowLimit: maxCalendarEvents,
	})
	if err != nil {
		httpx.Fail(w, s.log, "rider calendar feed failed", err, "The calendar could not be loaded. Try again.", "user", store.UUIDString(user.ID))
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
	s.warnIfTruncated(len(rows), "rider", "user", store.UUIDString(user.ID))
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
		httpx.Fail(w, s.log, "ics rotate failed", err, "The calendar link could not be reset. Try again.", "room", room.Slug)
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
		httpx.Fail(w, s.log, "rider ics rotate failed", err, "The calendar link could not be reset. Try again.", "user", store.UUIDString(user.ID))
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
	// A bearer URL's body is not for any shared cache (#1688, ADR-0021): a
	// 200 with no Cache-Control is heuristically cacheable (RFC 9111 §4.2.2),
	// and what the rider plans to ride, and with whom, is the sensitive part.
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
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
			icsEscape(e.roomName), icsEscape(host), e.roomSlug)
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
