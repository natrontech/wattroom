package rooms

import (
	"net/http"
	"strconv"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The public room directory (ADR-0039) and a rider's own settings for a room.
// Split from rooms.go (#1265).

// directoryPageSize is one screenful. A list rather than a search (ux.md's
// 95% rule applies to a search box too), and paged rather than unbounded so
// the route cannot become a way to enumerate the instance in one request.
const directoryPageSize = 50

// maxDirectoryOffset keeps ?offset= inside int32 (audit 2026-09-09): past
// it, the narrowing wrapped negative and Postgres refused the read.
const maxDirectoryOffset = 1_000_000

// directoryEntryJSON is one room in the public directory (#1118, ADR-0039):
// what it is called, what it looks like, and where its door is. The absence
// of a member count and of any activity signal is the decision, not an
// oversight — see the query.
type directoryEntryJSON struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}

// handleDirectory lists rooms whose owners chose to be findable.
//
// Signed in, because everything in WattRoom is (ADR-0009) — "opt-in public"
// means opt-in to every rider on the instance, not to the web. Listing a room
// widens DISCOVERY and never ACCESS: this route hands back three fields, and
// a non-member following the slug still meets exactly the gates they met
// before, which is asserted rather than assumed.
//
// Registered before "GET /api/rooms/{slug}" so the literal wins over the
// wildcard — Go's mux prefers the more specific pattern, but the order also
// says which one is meant to.
func (s *Service) handleDirectory(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Sign in to browse rooms."); !ok {
		return
	}
	limit, offset := directoryPageSize, 0
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && n > 0 {
		offset = min(n, maxDirectoryOffset)
	}
	rows, err := s.store.Queries.ListListedRooms(r.Context(), db.ListListedRoomsParams{
		Lim: int32(limit), Off: int32(offset), //nolint:gosec // limit is the page size, offset clamped above
	})
	if err != nil {
		httpx.Fail(w, s.log, "room directory failed", err, "The directory could not be loaded.")
		return
	}
	out := make([]directoryEntryJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, directoryEntryJSON{Slug: row.Slug, Name: row.Name, Icon: row.Icon})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rooms": out})
}

// handleSetMyPrefs writes the caller's own settings for this room (#1100).
//
// Whole-object PATCH like the room's own settings: the member view sends its
// full local state on every change, so there is no partial-update shape to
// get wrong. There is no {userID} in the path and no user id in the body —
// the update is keyed on (room, caller), so "a rider cannot set another
// rider's preferences" is a property of the query rather than a check
// somebody has to remember.
//
// RequireMember answers a non-member with 403, which is what every other
// room-scoped write does (#638) and what chat, playlists and RSVP already
// return. A room's existence is not a secret — its slug is a URL, and
// handleGet gives a non-member the outsider view rather than a 404 — so
// refusing differently here would be the inconsistency.
func (s *Service) handleSetMyPrefs(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.RequireMember(w, r, "Join the room to set your own preferences for it.")
	if !ok {
		return
	}
	var req riderPrefsJSON
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	prefs, err := s.store.Queries.SetMembershipPrefs(r.Context(), db.SetMembershipPrefsParams{
		RoomID: room.ID, UserID: user.ID, Notify: req.Notify, OnBoard: req.OnBoard,
	})
	if err != nil {
		httpx.Fail(w, s.log, "set rider prefs failed", err, "That could not be saved. Try again.", "room", room.Slug)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, riderPrefsJSON{Notify: prefs.Notify, OnBoard: prefs.OnBoard})
}
