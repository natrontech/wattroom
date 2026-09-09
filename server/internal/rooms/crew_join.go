package rooms

import (
	"net/http"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The crew's door (ADR-0038 amended, #1236): what a share link shows, the
// join by code, and leaving. Split from crews.go (#1234).

// handleCrewDoor is what a share link shows before the join (#1236): the
// crew's name and icon and how many are in it, and nothing else — not its id,
// not its rooms, not its people. A code is a secret, so an unknown one and a
// malformed one read the same.
func (s *Service) handleCrewDoor(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew has that code. Check it with whoever shared it.")
		return
	}
	members, _ := s.store.Queries.CountCrewMembers(r.Context(), crew.ID)
	out := map[string]any{
		"name": crew.Name, "icon": crew.Icon, "members": members,
		"imageUrl": crewDoorImageURL(code, crew.HasImage),
	}
	// Someone already in the crew who follows its own link again gets the
	// way in rather than a Join that would do nothing: the id is theirs to
	// know, and only then.
	if user, signedIn := s.users.User(r); signedIn {
		if role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID}); err == nil && role != "" && role != "banned" {
			out["inCrew"] = true
			out["id"] = store.UUIDString(crew.ID)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// handleJoinCrew is the one way in (ADR-0038 amended, #1236). Joining stores
// a member row and nothing else: metrics stay visible only to people who
// actually enter a room, and a crew member has entered none yet. A ban is a
// row too and wins the conflict, so a banned rider is refused, not readmitted.
func (s *Service) handleJoinCrew(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to join a crew.")
	if !ok {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		// A crew's code is six characters; a friend code is eight
		// (friends.go), and the one pasted into the wrong box is a friend's.
		if len(code) == 8 {
			httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "That looks like a friend code — friends are added on the Friends page. A crew's code is six characters.", "code")
			return
		}
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "No crew has that code. Check it with whoever shared it.", "code")
		return
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
	if err != nil {
		s.log.Error("crew role lookup failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
		return
	}
	if role == "banned" {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "This crew removed you.")
		return
	}
	if role == "" {
		if err := s.store.Queries.JoinCrew(r.Context(), db.JoinCrewParams{CrewID: crew.ID, UserID: user.ID}); err != nil {
			s.log.Error("crew join failed", "err", err, "crew", store.UUIDString(crew.ID))
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
			return
		}
		s.log.Info("crew joined", "crew", store.UUIDString(crew.ID), "rider", store.UUIDString(user.ID))
		s.changed()
	}
	httpx.WriteJSON(w, http.StatusOK, roomCrewJSON{Id: store.UUIDString(crew.ID), Name: crew.Name, Icon: crew.Icon, Role: role})
}

// handleLeaveCrew takes the member row and every room membership in the crew
// in one move (#1228, #1236). The owner cannot leave — a crew is never
// ownerless — so they hand it on first (#1208). Sockets in the crew's rooms
// are severed the way a removal severs them.
func (s *Service) handleLeaveCrew(w http.ResponseWriter, r *http.Request) {
	crew, user, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if role == "owner" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "You own this crew — hand it to someone first, then leave.")
		return
	}
	if owned, err := s.store.Queries.CountRoomsOwnedInCrew(r.Context(), db.CountRoomsOwnedInCrewParams{CrewID: crew.ID, OwnerID: user.ID}); err != nil || owned > 0 {
		httpx.WriteError(w, http.StatusConflict, "conflict", "You own a room in this crew, and a room never leaves its crew — hand it to a member first.")
		return
	}
	slugs, _ := s.store.Queries.ListCrewRoomSlugs(r.Context(), crew.ID)
	err := s.store.Queries.LeaveCrewRooms(r.Context(), db.LeaveCrewRoomsParams{CrewID: crew.ID, UserID: user.ID})
	if err == nil {
		err = s.store.Queries.LeaveCrewRole(r.Context(), db.LeaveCrewRoleParams{CrewID: crew.ID, UserID: user.ID})
	}
	if err != nil {
		s.log.Error("crew leave failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Leaving did not work. Try again.")
		return
	}
	for _, slug := range slugs {
		s.evict(slug, store.UUIDString(user.ID))
	}
	s.log.Info("crew left", "crew", store.UUIDString(crew.ID), "rider", store.UUIDString(user.ID))
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
