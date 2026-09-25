package crews

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const movedNotFound = "Nothing lives at this link any more."

// handleMovedRoom answers where an old room link lands (#2446): the crew and
// the text and voice channels the room became, for the SPA's redirect
// (#2458). Signed in, like every read (ADR-0009). An id is activity's address
// (#2821), so it goes only to whom it would open: a rider outside the crew,
// or banned from it, meets the 404 an unknown slug does, and a channel they
// may not enter is left out. Old slugs circulate and can be walked, so a
// lookup spends a door guess like a crew code.
func (s *Service) handleMovedRoom(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to follow this link.")
	if !ok || s.throttleDoor(w, r) {
		return
	}
	row, err := s.store.Queries.MovedRoom(r.Context(), db.MovedRoomParams{
		Slug: strings.ToLower(r.PathValue("slug")), Viewer: user.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", movedNotFound)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "moved room lookup failed", err, "That link could not be followed. Try again.")
		return
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: row.CrewID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "That link could not be followed. Try again.")
		return
	}
	if role == "" || role == "banned" {
		httpx.WriteError(w, http.StatusNotFound, "not_found", movedNotFound)
		return
	}
	out := map[string]string{"crewId": store.UUIDString(row.CrewID)}
	if row.TextChannelID.Valid {
		out["textChannelId"] = store.UUIDString(row.TextChannelID)
	}
	if row.VoiceChannelID.Valid {
		out["voiceChannelId"] = store.UUIDString(row.VoiceChannelID)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
