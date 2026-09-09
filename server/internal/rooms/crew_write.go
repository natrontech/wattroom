// Changing a crew (ADR-0038): the rename with its icon, and the roles —
// admin, member, banned. Split from crews.go, which keeps the read and the
// resolution of which crew a request is about.
package rooms

import (
	"net/http"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleUpdateCrew: the rename the day-one screen exists for (#1151), and
// the icon. Owner or admin — "crew admins manage" is the ADR's line, and a
// name is the crew's, not a room's.
func (s *Service) handleUpdateCrew(w http.ResponseWriter, r *http.Request) {
	crew, _, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if !administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner or an admin can change that.")
		return
	}
	var req struct {
		Name string  `json:"name"`
		Icon *string `json:"icon"` // nil keeps, "" clears
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A crew name has to be 1-60 characters.", "name")
		return
	}
	icon := crew.Icon
	if req.Icon != nil {
		icon = strings.TrimSpace(*req.Icon)
		if icon != "" && !protocol.IsIconOrEmoji(icon) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A crew icon is one from the set, or none.", "icon")
			return
		}
	}
	updated, err := s.store.Queries.UpdateCrew(r.Context(), db.UpdateCrewParams{ID: crew.ID, Name: req.Name, Icon: icon})
	if err != nil {
		s.log.Error("crew update failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be saved.")
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusOK, roomCrewJSON{
		Id: store.UUIDString(updated.ID), Name: updated.Name, Icon: updated.Icon, Role: role,
		ImageURL: crewImageURL(updated.ID, updated.ImageSetAt.Valid),
	})
}

// handleSetCrewRole: admin, member (clears an admin grant or lifts a crew
// ban) or banned. Owner or admin may act; the owner is never a target
// (ADR-0038, second amendment: cannot be demoted, removed or banned).
//
// A crew ban acts as well as records (third amendment): it severs the
// socket and voice in every room of the crew on the spot. Lifting one
// reconnects nobody and touches no room ban — separate decisions by separate
// people, and the UI says so (#1150).
func (s *Service) handleSetCrewRole(w http.ResponseWriter, r *http.Request) {
	crew, actor, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if !administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner or an admin can do that.")
		return
	}
	var req struct {
		UserID string `json:"userId"`
		Role   string `json:"role"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if req.Role != "admin" && req.Role != "member" && req.Role != "banned" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A crew role is admin, member or banned — ownership does not transfer here.", "role")
		return
	}
	target, err := store.ParseUUID(req.UserID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a user id.", "userId")
		return
	}
	if target == crew.OwnerID {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"The crew's owner cannot be demoted, removed or banned.")
		return
	}
	if target == actor.ID {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"Your own crew role is not yours to change.")
		return
	}
	if req.Role == "banned" {
		// A room never leaves its crew, so its owner cannot either (#1212):
		// banning them would orphan a room nobody else can moderate, and
		// leave a banned person for the successor of last resort to pick.
		owned, err := s.store.Queries.CountRoomsOwnedInCrew(r.Context(), db.CountRoomsOwnedInCrewParams{CrewID: crew.ID, OwnerID: target})
		if err != nil {
			s.log.Error("crew ban owner check failed", "err", err, "crew", store.UUIDString(crew.ID))
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The role could not be changed.")
			return
		}
		if owned > 0 {
			httpx.WriteError(w, http.StatusConflict, "conflict",
				"They own a room in this crew, and a room never leaves its crew — so neither can its owner. Ban them from your rooms instead.")
			return
		}
	}
	// Membership is a row since #1236, so "member" is written, never cleared:
	// deleting the row demoted an admin clean out of the crew and left an
	// unbanned rider with no membership to come back to (audit 2026-09-09).
	err = s.store.Queries.SetCrewRole(r.Context(), db.SetCrewRoleParams{CrewID: crew.ID, UserID: target, Role: req.Role})
	if err != nil {
		s.log.Error("crew role update failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The role could not be changed.")
		return
	}
	if req.Role == "banned" {
		slugs, err := s.store.Queries.ListCrewRoomSlugs(r.Context(), crew.ID)
		if err != nil {
			s.log.Error("crew rooms lookup failed", "err", err, "crew", store.UUIDString(crew.ID))
		}
		for _, slug := range slugs {
			s.evict(slug, req.UserID)
		}
		s.log.Info("crew ban", "crew", store.UUIDString(crew.ID), "rider", req.UserID, "rooms", len(slugs))
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
