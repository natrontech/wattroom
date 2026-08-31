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

// iCal feed for planned sessions (#245). Calendar apps can't sign in, so the
// URL carries a per-room secret token — the same "private address" pattern
// Google Calendar uses; the owner rotates it when it leaks.

func (s *Service) handleCalendar(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	token := strings.TrimSuffix(r.PathValue("token"), ".ics")
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
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	_, _ = io.WriteString(w, buildICS(room, r.Host, rows))
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

func buildICS(room db.Room, host string, rows []db.ListRoomCalendarRow) string {
	var b strings.Builder
	fmt.Fprintf(&b, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"+
		"PRODID:-//WattRoom//planned sessions//EN\r\nCALSCALE:GREGORIAN\r\n"+
		"METHOD:PUBLISH\r\nX-WR-CALNAME:%s\r\n", icsEscape(room.Name+" · WattRoom"))
	for _, row := range rows {
		start := row.StartsAt.Time
		fmt.Fprintf(&b, "BEGIN:VEVENT\r\nUID:%s@wattroom\r\nDTSTAMP:%s\r\n"+
			"DTSTART:%s\r\nDTEND:%s\r\nSUMMARY:%s\r\nDESCRIPTION:%s\r\n"+
			"URL:https://%s/r/%s\r\nEND:VEVENT\r\n",
			store.UUIDString(row.ID), icsTime(row.CreatedAt.Time),
			icsTime(start), icsTime(start.Add(workoutLength(string(row.WorkoutJson)))),
			icsEscape(row.WorkoutName),
			icsEscape("Planned by "+row.CreatedBy+" in "+room.Name+"."),
			host, room.Slug)
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
