package crews

import (
	"crypto/subtle"
	"fmt"
	"io"
	"math"
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
// Two feeds, two subjects (ADR-0021 as amended by ADR-0058, #2441). The crew
// feed is a crew's schedule, shareable with people who aren't in it. The
// rider feed is every crew you ride with, and is the one the UI offers first.

// The feeds' bounds, docs/SPEC.md (#1414). Both feeds render their whole
// result into one in-memory string per request, behind nothing but a bearer
// token in the URL, so "uncapped" made row growth into a memory spike anybody
// with the link could ask for. calendarHorizon is generous against
// plannableAt's three months, and maxCalendarEvents against the 100-plan
// shelf — ten crews' worth of full schedules — so a rider reaching either
// bound has hit something no product surface can produce.
const (
	calendarHistory   = 30 * 24 * time.Hour
	calendarHorizon   = 365 * 24 * time.Hour
	maxCalendarEvents = 1000
)

// calendarUntil is the far edge every calendar read shares — the feeds and
// Home's list alike, so none of them can quietly disagree about how far ahead
// a plan is visible.
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
	id     string
	stamp  time.Time
	start  time.Time
	length time.Duration
	// planner is the rider feed's alone and empty everywhere else —
	// description says why.
	planner string
	summary string
	// Where it runs, as a calendar shows it — "Thursday Crew · Pain Cave" —
	// and the path that opens it: the voice channel, or the crew's schedule.
	place string
	path  string
}

// eventPlace is a plan's LOCATION and URL path: the crew and the voice
// channel it names, or the crew's schedule while it names none.
func eventPlace(crewID pgtype.UUID, crewName string, channelID pgtype.UUID, channelName string) (place, path string) {
	crew := store.UUIDString(crewID)
	if channelID.Valid && channelName != "" {
		return crewName + " · " + channelName, "/crew/" + crew + "/v/" + store.UUIDString(channelID)
	}
	return crewName, "/crew/" + crew + "/schedule"
}

// description is the line a subscriber reads under the event, and the one
// place the two feeds say different things (ADR-0021's 2026-09-17 amendment,
// #1767).
//
// A crew's ics_token is handed to every member, and the feed exists to be
// shared with people who are not in the crew — so one member forwarding the
// link hands whatever it says to whoever they like. Who planned a session is
// the only thing in it that names a person, so the crew feed does not carry
// it. The rider feed does: that token is one rider's own, they rotate it
// themselves, and it lists only crews they are in, where ADR-0036 already
// gives them the name.
func (e icsEvent) description() string {
	if e.planner == "" {
		return "In " + e.place + "."
	}
	return "Planned by " + e.planner + " in " + e.place + "."
}

// handleCrewCalendar is the crew's feed (#2441): no session, just the token
// in the URL, compared in constant time. A wrong token and a crew that is not
// there read the same.
func (s *Service) handleCrewCalendar(w http.ResponseWriter, r *http.Request) {
	refuse := func() {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That calendar link is not valid — ask in the crew for the current one.")
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		refuse()
		return
	}
	crew, err := s.store.Queries.GetCrewCalendar(r.Context(), id)
	if err != nil || subtle.ConstantTimeCompare([]byte(icsPathToken(r)), []byte(crew.IcsToken)) != 1 {
		refuse()
		return
	}
	rows, err := s.store.Queries.ListCrewCalendar(r.Context(), db.ListCrewCalendarParams{
		CrewID:      crew.ID,
		StartsFrom:  pgTime(time.Now().Add(-calendarHistory)),
		StartsUntil: calendarUntil(), RowLimit: maxCalendarEvents,
	})
	if err != nil {
		httpx.Fail(w, s.log, "crew calendar feed failed", err, "The calendar could not be loaded. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	events := make([]icsEvent, 0, len(rows))
	for _, row := range rows {
		place, path := eventPlace(crew.ID, crew.Name, row.ChannelID, row.ChannelName)
		events = append(events, icsEvent{
			id: store.UUIDString(row.ID), stamp: row.CreatedAt.Time, start: row.StartsAt.Time,
			length: workoutLength(string(row.WorkoutJson)), summary: row.WorkoutName,
			place: place, path: path,
		})
	}
	s.warnIfTruncated(len(rows), "crew", "crew", store.UUIDString(crew.ID))
	writeICS(w, crew.Name+" · WattRoom", r.Host, events)
}

// handleUserCalendar is the rider-addressed feed (#325): one subscription
// that follows the crews you ride with (#2441).
func (s *Service) handleUserCalendar(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.Queries.GetUserByIcsToken(r.Context(), icsPathToken(r))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That calendar link is not valid — copy the current one from Settings, under Your data.")
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
		place, path := eventPlace(row.CrewID, row.CrewName, row.ChannelID, row.ChannelName)
		events = append(events, icsEvent{
			id: store.UUIDString(row.ID), stamp: row.CreatedAt.Time, start: row.StartsAt.Time,
			length: workoutLength(string(row.WorkoutJson)), summary: row.WorkoutName,
			planner: row.CreatedBy, place: place, path: path,
		})
	}
	s.warnIfTruncated(len(rows), "rider", "user", store.UUIDString(user.ID))
	writeICS(w, "WattRoom sessions", r.Host, events)
}

// handleRotateCrewIcs is the leak escape hatch (#2441): the crew's owner or
// an admin, and the old feed URL dies on the spot — every subscriber re-adds
// the new one. The confirm that says so is the page's (errors.md).
func (s *Service) handleRotateCrewIcs(w http.ResponseWriter, r *http.Request) {
	crew, _, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if !administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner or an admin can reset its calendar link.")
		return
	}
	token, err := s.store.Queries.RotateCrewIcsToken(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "crew ics rotate failed", err, "The calendar link could not be reset. Try again.", "crew", store.UUIDString(crew.ID))
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
			"LOCATION:%s\r\nURL:https://%s%s\r\nEND:VEVENT\r\n",
			e.id, icsTime(e.stamp), icsTime(e.start), icsTime(e.start.Add(e.length)),
			icsEscape(e.summary), icsEscape(e.description()),
			icsEscape(e.place), icsEscape(host), e.path)
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

// workoutMinutes is workoutLength as a cross-crew list shows it (#1693),
// rounded the way the crew's own schedule rounds it so one plan never reads
// as two lengths on two screens.
func workoutMinutes(workoutJSON string) int {
	return int(math.Round(workoutLength(workoutJSON).Minutes()))
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
