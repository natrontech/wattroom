package rooms

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What a room row says about itself to a crew member who is not in it
// (#1149), and the one permission a crew admin holds over such a room
// (#1226). Split from crews.go (#1234).

// accessOf is the one place a row's state is derived from the facts the
// queries hand back (#1149). Enterable rooms say whether they are open or
// private; the rest split on whether the caller administers the crew.
func accessOf(crewVisible, enterable, administers bool) string {
	switch {
	case enterable && crewVisible:
		return accessOpen
	case enterable:
		return accessPrivate
	case administers:
		return accessAdmin
	default:
		return accessLocked
	}
}

// doorOf is what a crew-room row you are NOT in may say about where its
// door is. The slug IS the door: /r/{slug} joins anyone who is not banned,
// which is the share-link front door ADR-0038 keeps. So a row the caller
// cannot enter names the room by id and keeps the slug to itself (#1205) —
// "private, you are not in this room" has to hold on the wire, not only in
// which rows the client declines to draw as links.
func doorOf(row db.ListCrewRoomsForRow) (slug, access string) {
	access = accessOf(row.CrewVisible, row.Enterable, row.Administers)
	if row.Enterable {
		slug = row.Slug
	}
	return slug, access
}

// handleSetRoomAccess: a crew admin opens a room to the crew or shuts it
// (#1226) — the permission the `admin` access state (#1149) exists for, and
// until now the only thing that state could not do. Addressed by room id, not
// slug: a row the caller may not enter carries no slug (#1205), and this is
// exactly that row. The room's owner may use it too; the settings ladder
// (#1204) is the same switch from inside. Nothing else about the room moves,
// and nothing is read back — contents stay the members' (ADR-0038, second
// amendment).
func (s *Service) handleSetRoomAccess(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	roomID, err := store.ParseUUID(r.PathValue("roomID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No room lives here.")
		return
	}
	room, err := s.store.Queries.GetRoomInCrew(r.Context(), db.GetRoomInCrewParams{ID: roomID, CrewID: crew.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No room lives here.")
		return
	}
	if err != nil {
		s.log.Error("room lookup failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be changed.")
		return
	}
	if !administers(role) && room.OwnerID != user.ID {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"Only the crew's owner or an admin — or the room's own owner — can change who may enter it.")
		return
	}
	var req struct {
		CrewVisible bool `json:"crewVisible"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if err := s.store.Queries.SetRoomCrewVisible(r.Context(), db.SetRoomCrewVisibleParams{ID: room.ID, CrewVisible: req.CrewVisible}); err != nil {
		s.log.Error("room access update failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be changed.")
		return
	}
	s.log.Info("room access set", "room", room.Slug, "crewVisible", req.CrewVisible, "by", store.UUIDString(user.ID))
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
