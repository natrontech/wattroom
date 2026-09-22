package crews

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
)

// handleMovedRoom answers where an old room link lands (#2446): the crew and
// the text and voice channels the room became, for the SPA's redirect
// (#2458). Signed in, like every read (ADR-0009) — and it hands out ids
// only, which open nothing: the crew and its channels keep their own gates,
// so a rider the room never admitted meets the same 404 they would have.
func (s *Service) handleMovedRoom(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Sign in to follow this link."); !ok {
		return
	}
	row, err := s.store.Queries.MovedRoom(r.Context(), strings.ToLower(r.PathValue("slug")))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Nothing lives at this link any more.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "moved room lookup failed", err, "That link could not be followed. Try again.")
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
