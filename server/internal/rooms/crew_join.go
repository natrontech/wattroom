package rooms

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The crew's door (ADR-0038 amended, #1236): what a share link shows, the
// join by code, and leaving. Split from crews.go (#1234).

// handleCrewDoor is what a share link shows before the join (#1236): the
// crew's name and icon, and nothing else — not its id, not its rooms, not its
// people, and not how many of them there are. ADR-0038's amendment authorises
// the name and what joining shows; ADR-0039 refused a headcount to a stranger
// as "a separate disclosure", and the count shipped here anyway (#1399). A
// code is a secret, so an unknown one and a malformed one read the same.
func (s *Service) handleCrewDoor(w http.ResponseWriter, r *http.Request) {
	if s.throttleDoor(w, r) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		// A wrong code and a database that could not be asked are different
		// answers: the second used to read as the first, which hid the
		// client's own retry (audit 2026-09-09).
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "crew door lookup failed", err, "The door could not be opened. Try again.")
			return
		}
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No crew has that code. Check it with whoever shared it.")
		return
	}
	out := map[string]any{
		"name": crew.Name, "icon": crew.Icon,
		"imageUrl": crewDoorImageURL(code, crew.HasImage),
	}
	// Someone already in the crew who follows its own link again gets the
	// way in rather than a Join that would do nothing: the id and the
	// headcount are theirs to know, and only then — the roster on the crew's
	// own page shows both already.
	if user, signedIn := s.users.User(r); signedIn {
		role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
		switch {
		case err != nil:
		case role == "banned":
			// Said at the door rather than on the click: a ban survives the
			// code (docs/SPEC.md), so the Join it withholds would only have
			// been refused (audit 2026-09-09).
			out["banned"] = true
		case role != "":
			out["inCrew"] = true
			out["id"] = store.UUIDString(crew.ID)
			out["members"], _ = s.store.Queries.CountCrewMembers(r.Context(), crew.ID)
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
	if s.throttleDoor(w, r) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	crew, err := s.store.Queries.GetCrewByCode(r.Context(), &code)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(w, s.log, "crew code lookup failed", err, "Joining did not work. Try again.")
			return
		}
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
		httpx.Fail(w, s.log, "crew role lookup failed", err, "Joining did not work. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	if role == "banned" {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "This crew removed you.")
		return
	}
	if role == "" {
		if err := s.store.Queries.JoinCrew(r.Context(), db.JoinCrewParams{CrewID: crew.ID, UserID: user.ID}); err != nil {
			httpx.Fail(w, s.log, "crew join failed", err, "Joining did not work. Try again.", "crew", store.UUIDString(crew.ID))
			return
		}
		s.log.Info("crew joined", "crew", store.UUIDString(crew.ID), "rider", store.UUIDString(user.ID))
		s.changed()
		// The role AFTER the join: the row just written (audit 2026-09-09).
		role = "member"
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
	owned, err := s.store.Queries.CountRoomsOwnedInCrew(r.Context(), db.CountRoomsOwnedInCrewParams{CrewID: crew.ID, OwnerID: user.ID})
	if err != nil {
		// Fail closed, and say so — not "you own a room" (audit 2026-09-09).
		httpx.Fail(w, s.log, "crew leave owner check failed", err, "Leaving did not go through. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	if owned > 0 {
		httpx.WriteError(w, http.StatusConflict, "conflict", "You own a room in this crew, and a room never leaves its crew — hand it to a member first.")
		return
	}
	slugs, _ := s.store.Queries.ListCrewRoomSlugs(r.Context(), crew.ID)
	err = s.store.Queries.LeaveCrewRooms(r.Context(), db.LeaveCrewRoomsParams{CrewID: crew.ID, UserID: user.ID})
	if err == nil {
		// The confirm promised it: "a private room needs a fresh invitation
		// from its owner" — the grant used to outlive the membership (#1672).
		err = s.store.Queries.LeaveCrewGrants(r.Context(), db.LeaveCrewGrantsParams{CrewID: crew.ID, UserID: user.ID})
	}
	if err == nil {
		err = s.store.Queries.LeaveCrewRole(r.Context(), db.LeaveCrewRoleParams{CrewID: crew.ID, UserID: user.ID})
	}
	if err != nil {
		httpx.Fail(w, s.log, "crew leave failed", err, "Leaving did not work. Try again.", "crew", store.UUIDString(crew.ID))
		return
	}
	for _, slug := range slugs {
		s.evict(slug, store.UUIDString(user.ID))
	}
	s.log.Info("crew left", "crew", store.UUIDString(crew.ID), "rider", store.UUIDString(user.ID))
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
