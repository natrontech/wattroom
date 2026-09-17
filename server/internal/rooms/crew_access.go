package rooms

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What a room row says about itself to a crew member who is not in it
// (#1149), and the permissions a crew admin holds over such a room — its
// door, wide (#1226) and narrow (#2294). Split from crews.go (#1234).

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

// keepsTheDoor answers ADR-0038's "Crew admins manage room permissions" for
// one room: its own owner, or the crew's owner or an admin, says who gets in.
// It is the whole rule behind both doors — the wide one that opens a room to
// the entire crew (#1226) and the narrow one that names a single crew-mate
// through it (grants.go, #2294) — and deliberately not a moderation gate:
// nothing that reads, renames or moderates the room asks it. crewRole is ""
// for a room outside any crew, which leaves the room's owner.
func keepsTheDoor(crewRole string, ownerID, userID pgtype.UUID) bool {
	return administers(crewRole) || ownerID == userID
}

// doorkeeperRefusal is what everyone else hears at either door.
const doorkeeperRefusal = "Only the crew's owner or an admin — or the room's own owner — can change who may enter it."

// requireDoorkeeper is keepsTheDoor asked of a `/api/rooms/{slug}` route,
// which carries no crew role of its own. A ban at either level shuts the door
// on its keeper too (#1763): a crew admin the room's owner banned has no
// business naming people into it.
func (s *Service) requireDoorkeeper(w http.ResponseWriter, r *http.Request) (db.Room, db.User, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return db.Room{}, db.User{}, false
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return db.Room{}, db.User{}, false
	}
	var crewRole string
	if room.CrewID.Valid {
		role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: room.CrewID, UserID: user.ID})
		if err != nil {
			// The database did not answer (#1984): not a refusal.
			httpx.Fail(w, s.log, "crew role lookup failed", err, "The room could not be checked. Try again.", "room", room.Slug)
			return db.Room{}, db.User{}, false
		}
		crewRole = role
	}
	if !keepsTheDoor(crewRole, room.OwnerID, user.ID) || s.isBanned(r, room, user) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", doorkeeperRefusal)
		return db.Room{}, db.User{}, false
	}
	return room, user, true
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
		httpx.Fail(w, s.log, "room lookup failed", err, "The room could not be changed.", "crew", store.UUIDString(crew.ID))
		return
	}
	if !keepsTheDoor(role, room.OwnerID, user.ID) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", doorkeeperRefusal)
		return
	}
	var req struct {
		CrewVisible bool `json:"crewVisible"`
		// Optional: the listing to restore with the door (#1929). Absent, a
		// shut still takes the listing with it and an open leaves it be.
		Listed *bool `json:"listed"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if req.Listed != nil {
		err = s.store.Queries.SetRoomCrewVisibleAndListed(r.Context(), db.SetRoomCrewVisibleAndListedParams{
			ID: room.ID, CrewVisible: req.CrewVisible, Listed: *req.Listed,
		})
	} else {
		err = s.store.Queries.SetRoomCrewVisible(r.Context(), db.SetRoomCrewVisibleParams{ID: room.ID, CrewVisible: req.CrewVisible})
	}
	if err != nil {
		httpx.Fail(w, s.log, "room access update failed", err, "The room could not be changed.", "room", room.Slug)
		return
	}
	s.log.Info("room access set", "room", room.Slug, "crewVisible", req.CrewVisible, "by", store.UUIDString(user.ID))
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
