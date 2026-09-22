package rooms

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/recap"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What a crew shows about its members (ADR-0036 as amended by ADR-0058,
// #2442): the roster with roles and medals, the crew streak, its sessions
// against its own last month, the weekly board when the crew keeps one, the
// caller's own switches, and the recaps of sessions in channels they may
// enter. The room's versions of all of these go with the room (#2446).

// maxCrewRecaps is an engineering bound (#1416), not a product number: the
// 90 days of docs/SPEC.md are the real limit, and this keeps one busy crew's
// quarter from being one unbounded response.
const maxCrewRecaps = 500

type crewMembersJSON struct {
	Members []crewPersonJSON `json:"members"`
	// Owner and admins only, as on the crew page.
	Banned []crewPersonJSON `json:"banned,omitempty"`
	// The caller's own switches and nobody else's.
	Me riderPrefsJSON `json:"me"`
	// The crew streak (docs/SPEC.md): UTC weeks, one per week however many
	// voice channels rode in it. Pays nothing.
	StreakWeeks int           `json:"streakWeeks"`
	Together    *togetherJSON `json:"together,omitempty"`
	// The board's switch, and its rows only while it is on.
	BoardEnabled bool           `json:"boardEnabled"`
	Board        []boardRowJSON `json:"board,omitempty"`
}

// handleCrewMembers: the crew's Members page. Members only — crewByID answers
// everyone else 404. The stats reads soft-fail like the room's did: a query
// that cannot answer is a tile that does not render, never a page that will
// not open. The roster is the one read that fails loudly, because an empty
// roster would read as a crew with nobody in it.
func (s *Service) handleCrewMembers(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	people, banned, err := s.crewPeople(r.Context(), crew, user, role)
	if err != nil {
		httpx.Fail(w, s.log, "list crew people failed", err, "The crew's members could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	if rows, err := s.store.Queries.CountCrewMedalsByRider(r.Context(), crew.ID); err == nil {
		medals := make(map[string]int, len(rows))
		for _, row := range rows {
			medals[store.UUIDString(row.UserID)] = int(row.Medals)
		}
		for i := range people {
			people[i].Medals = medals[people[i].ID]
		}
	} else {
		s.log.Warn("count crew medals failed", "err", err, "crew", store.UUIDString(crew.ID))
	}
	out := crewMembersJSON{Members: people, Banned: banned, BoardEnabled: crew.BoardEnabled}
	if prefs, err := s.store.Queries.GetCrewPrefs(r.Context(), db.GetCrewPrefsParams{CrewID: crew.ID, UserID: user.ID}); err == nil {
		out.Me = riderPrefsJSON{Notify: prefs.Notify, OnBoard: prefs.OnBoard}
	} else {
		s.log.Warn("crew prefs read failed", "err", err, "crew", store.UUIDString(crew.ID))
	}
	if weeks, err := s.store.Queries.ListCrewRideWeeks(r.Context(), crew.ID); err == nil {
		times := make([]time.Time, len(weeks))
		for i, w := range weeks {
			times[i] = w.Time
		}
		out.StreakWeeks = stats.WeekStreak(times, time.Now(), time.UTC)
	}
	out.Together = s.crewTogether(r, crew.ID, user.ID)
	if crew.BoardEnabled {
		if rows, err := s.store.Queries.CrewWeekBoard(r.Context(), crew.ID); err == nil {
			out.Board = make([]boardRowJSON, 0, len(rows))
			for _, row := range rows {
				out.Board = append(out.Board, boardRowOf(row))
			}
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// crewTogether is the room's together read at the crew: sums over every
// channel — a sum names nobody (ADR-0036) — and the caller's own turnout.
func (s *Service) crewTogether(r *http.Request, crewID, viewer pgtype.UUID) *togetherJSON {
	totals, err := s.store.Queries.CrewTotals(r.Context(), crewID)
	if err != nil {
		return nil
	}
	out := &togetherJSON{
		Seconds:           totals.Seconds,
		SessionsThisMonth: totals.SessionsThisMonth,
		SessionsLastMonth: totals.SessionsLastMonth,
	}
	days, err := s.store.Queries.ListCrewSessionDays(r.Context(), db.ListCrewSessionDaysParams{CrewID: crewID, ViewerID: viewer})
	if err != nil {
		return out
	}
	// Oldest first: the strip reads left to right like every other timeline.
	out.Attended = make([]bool, len(days))
	for i, day := range days {
		out.Attended[len(days)-1-i] = day.Attended
	}
	return out
}

// handleSetCrewPrefs writes the caller's own switches on their crew
// membership (#2432) — planned-session mail and the board's include-me.
// Whole-object, keyed on (crew, caller) like the room's it replaces, so a
// rider setting another rider's switches is not a request this can express.
func (s *Service) handleSetCrewPrefs(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	var req riderPrefsJSON
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	prefs, err := s.store.Queries.SetCrewPrefs(r.Context(), db.SetCrewPrefsParams{
		CrewID: crew.ID, UserID: user.ID, Notify: req.Notify, OnBoard: req.OnBoard,
	})
	if err != nil {
		httpx.Fail(w, s.log, "set crew prefs failed", err, "That could not be saved. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusOK, riderPrefsJSON{Notify: prefs.Notify, OnBoard: prefs.OnBoard})
}

// handleCrewRecaps: the crew's session recaps (ADR-0034), for its current
// members, and of each only the sessions in a channel the caller may enter —
// docs/SPEC.md, because a recap is presence and presence is never a way into
// a private channel. Leaving the crew ends access: crewByID asks today.
func (s *Service) handleCrewRecaps(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewRecaps(r.Context(), db.ListCrewRecapsParams{
		CrewID: crew.ID, Viewer: user.ID, Admin: administers(role),
		Days: recap.RetentionDays, MaxRows: maxCrewRecaps,
	})
	if err != nil {
		httpx.Fail(w, s.log, "list crew recaps failed", err, "The crew's sessions could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	out := make([]protocol.SessionRecap, 0, len(rows))
	for _, row := range rows {
		if rec, ok := recap.Decode(s.log, row); ok {
			out = append(out, rec)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"recaps": out})
}
