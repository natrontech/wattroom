package channels

import (
	"fmt"
	"net/http"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// CrewSessions is what channels asks of the hub about a crew's own sessions
// (docs/SESSIONS.md), which run beside its voice channels. Satisfied by
// *hub.Hub.
type CrewSessions interface {
	CrewSessions(crew string) []protocol.LiveSession
	OpenCrewSession(crew string, rider protocol.Rider, pick protocol.Control) (id, code, message string)
}

// SetCrewSessions wires the hub's crew sessions in.
func (s *Service) SetCrewSessions(c CrewSessions) { s.crewSessions = c }

// AuthorizeCrew is a crew session's door: any member of the crew, its owner
// and admins included, and nobody banned or outside it — the same answer an
// open voice channel gives.
func (s *Service) AuthorizeCrew(r *http.Request, id string) (protocol.Rider, string, error) {
	user, ok := s.users.User(r)
	if !ok {
		return protocol.Rider{}, "", av.ErrNoSession
	}
	crewID, err := store.ParseUUID(id)
	if err != nil {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crewID, UserID: user.ID})
	if err != nil {
		return protocol.Rider{}, "", fmt.Errorf("channels: authorize crew: %w", err)
	}
	if !mayEnter(role, false, false) {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	return s.riderOf(r.Context(), user, role, "crew", id), store.UUIDString(crewID), nil
}

// handleOpenCrewSession starts a session of the crew's own with the caller
// as its coach: the workout they picked, on a road if it carries one. The
// answer is its id, which is its address.
func (s *Service) handleOpenCrewSession(w http.ResponseWriter, r *http.Request) {
	if s.crewSessions == nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Sessions are not running on this server.")
		return
	}
	crewID, user, role, ok := s.crewFor(w, r)
	if !ok {
		return
	}
	var pick protocol.Control
	if err := httpx.DecodeStrict(r, &pick); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a workout the session can ride.")
		return
	}
	rider := s.riderOf(r.Context(), user, role, "crew", store.UUIDString(crewID))
	id, code, message := s.crewSessions.OpenCrewSession(store.UUIDString(crewID), rider, pick)
	if code != "" {
		status := http.StatusBadRequest
		switch code {
		case "conflict":
			status = http.StatusConflict
		case "forbidden", "consent_forbidden":
			status = http.StatusForbidden
		case "not_found":
			status = http.StatusNotFound
		}
		httpx.WriteError(w, status, code, message)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]string{"id": id})
}
