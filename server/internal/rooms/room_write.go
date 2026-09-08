package rooms

import (
	"net/http"
	"strings"

	"fmt"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Making, changing and deleting a room — the owner's side. Split from
// rooms.go (#1265).

// maxOwnedRooms is docs/SPEC.md's ownership cap (membership is uncapped).
const maxOwnedRooms = 3

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to create a room.")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
		// The crew to open it in (#1201); empty means your own.
		CrewID string `json:"crewId"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A room name has to be 1-60 characters.", "name")
		return
	}
	// docs/SPEC.md ownership cap: 3 owned rooms; membership is uncapped and
	// deleting a room frees the slot. 409 — the state, not the request, refuses.
	if owned, err := s.store.Queries.CountOwnedRooms(r.Context(), user.ID); err == nil && owned >= maxOwnedRooms {
		httpx.WriteError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("You already own %d rooms — delete one to open another.", maxOwnedRooms))
		return
	}

	// Resolved before the room row exists, so a refusal leaves nothing behind.
	crew, crewRole, ok := s.creationCrew(w, r, user, req.CrewID)
	if !ok {
		return
	}
	// Slug and code both need uniqueness; retry on collision rather than
	// checking first — the constraint is the check. Every new room's slug
	// carries a random suffix (#694): the name alone must not be enough to
	// guess a room's URL, since a successful join grants membership. Existing
	// rooms keep their bare-name slugs — link stability matters more than
	// retrofitting them, and rename (handleUpdate) never touches Slug, so the
	// suffix stays fixed for the room's lifetime.
	var room db.Room
	for attempt := 0; ; attempt++ {
		slug := slugify(req.Name) + "-" + randomCode(4)
		created, err := s.store.Queries.CreateRoom(r.Context(), db.CreateRoomParams{
			Code: randomCode(6), Slug: strings.ToLower(slug), Name: req.Name, OwnerID: user.ID,
		})
		if err == nil {
			room = created
			break
		}
		if isUniqueViolation(err) && attempt < 3 {
			continue
		}
		s.log.Error("room create failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return
	}

	err := s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "owner",
	})
	if err != nil {
		s.log.Error("owner membership failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return
	}
	// New rooms are created inside a crew and are open to it (ADR-0038).
	// Crew-visible is set here and not by the column's default, which is
	// false so that a rolled-back image and a forgotten INSERT both fail
	// towards private.
	err = s.store.Queries.PlaceRoomInCrew(r.Context(), db.PlaceRoomInCrewParams{
		ID: room.ID, CrewID: crew.ID, CrewVisible: true,
	})
	if err != nil {
		s.log.Error("room crew placement failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, roomJSON{
		Slug: room.Slug, Code: room.Code, Name: room.Name, Listed: room.Listed, Role: "owner",
		Crew: &roomCrewJSON{Id: store.UUIDString(crew.ID), Name: crew.Name, Icon: crew.Icon, ImageURL: crewImageURL(crew.ID, crew.HasImage), Role: crewRole},
	})
}

// creationCrew is the crew a new room lands in (#1201): the one the caller
// named, when they own or administer it — Discord's Manage Channels, so a
// group's second and third rooms can be opened by the people running it
// rather than only by whoever happened to make the first — else the
// caller's own, made with their first room. Refused, not redirected, when
// they may not: a room quietly landing in the wrong crew is the confusion
// #1201 describes.
func (s *Service) creationCrew(w http.ResponseWriter, r *http.Request, user db.User, crewID string) (db.GetCrewRow, string, bool) {
	if crewID == "" {
		crew, err := s.crewFor(r.Context(), user)
		if err != nil {
			s.log.Error("own crew lookup failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
				"The room could not be created. Try again.")
			return db.GetCrewRow{}, "", false
		}
		return asRow(crew), "owner", true
	}
	id, err := store.ParseUUID(crewID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a crew.", "crewId")
		return db.GetCrewRow{}, "", false
	}
	crew, err := s.store.Queries.GetCrew(r.Context(), id)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "No crew lives here.", "crewId")
		return db.GetCrewRow{}, "", false
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
	if err != nil {
		s.log.Error("crew role lookup failed", "err", err, "crew", crewID)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The room could not be created. Try again.")
		return db.GetCrewRow{}, "", false
	}
	if !administers(role) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"Only the crew's owner or an admin can open a room in it — ask them, or open one in your own crew.")
		return db.GetCrewRow{}, "", false
	}
	return crew, role, true
}

// handleUpdate: owner-only per the matrix — "Edit room (name, listing)".
func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	_ = user
	var req struct {
		Name      string    `json:"name"`
		Listed    bool      `json:"listed"`
		SoundPack string    `json:"soundPack"`
		Icon      *string   `json:"icon"`   // nil keeps, "" clears
		Cheers    *[]string `json:"cheers"` // nil keeps, [] resets to base
		// nil keeps: a rename must not silently switch the board on or off.
		BoardEnabled *bool `json:"boardEnabled"`
		// nil keeps, for the same reason — and because an older client's
		// rename must not shut a room its crew could walk into (#1204).
		CrewVisible *bool `json:"crewVisible"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 60 {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A room name has to be 1-60 characters.", "name")
		return
	}
	if req.SoundPack == "" {
		req.SoundPack = room.SoundPack // absent field keeps the current pack
	}
	if req.SoundPack != "base" && req.SoundPack != "silent" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A sound pack is base or silent.", "soundPack")
		return
	}
	icon := room.Icon
	if req.Icon != nil {
		icon = strings.TrimSpace(*req.Icon)
		// An icon key (#447) — or an emoji, still accepted so rooms saved and
		// clients built before #447 keep working.
		if icon != "" && !protocol.IsIconOrEmoji(icon) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"A room icon is one from the set, or none.", "icon")
			return
		}
	}
	cheers := room.Cheers
	if req.Cheers != nil {
		if len(*req.Cheers) > maxCheers {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				fmt.Sprintf("A room speaks at most %d reactions.", maxCheers), "cheers")
			return
		}
		deduped := make([]string, 0, len(*req.Cheers))
		seen := map[string]struct{}{}
		for _, cheer := range *req.Cheers {
			// Same compat rule as the icon: keys now, emoji from before #447 too.
			if !protocol.IsIconOrEmoji(cheer) {
				httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
					"Reactions are icons from the set.", "cheers")
				return
			}
			if _, dup := seen[cheer]; dup {
				continue
			}
			seen[cheer] = struct{}{}
			deduped = append(deduped, cheer)
		}
		cheers = strings.Join(deduped, " ") // "" = back to the base set
	}
	boardEnabled := room.BoardEnabled
	if req.BoardEnabled != nil {
		boardEnabled = *req.BoardEnabled
	}
	crewVisible := room.CrewVisible
	if req.CrewVisible != nil {
		crewVisible = *req.CrewVisible
	}
	updated, err := s.store.Queries.UpdateRoom(r.Context(), db.UpdateRoomParams{
		ID: room.ID, Name: req.Name, Listed: req.Listed, SoundPack: req.SoundPack,
		Icon: icon, Cheers: cheers, BoardEnabled: boardEnabled, CrewVisible: crewVisible,
	})
	if err != nil {
		s.log.Error("room update failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be saved.")
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusOK, roomJSON{
		Slug: updated.Slug, Code: updated.Code, Name: updated.Name, Icon: updated.Icon,
		Listed: updated.Listed, SoundPack: updated.SoundPack,
		Cheers: cheerSet(updated.Cheers), Role: "owner",
		BoardEnabled: updated.BoardEnabled, CrewVisible: updated.CrewVisible,
	})
}

// handleDelete: owner-only. Memberships and medals cascade with the room;
// rides survive with room_id set null — history stays each rider's own.
// ponytail: a live hub room drifts until its sockets close; nobody new can
// join a deleted room, so it dies of natural causes.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	room, _, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	if err := s.store.Queries.DeleteRoom(r.Context(), room.ID); err != nil {
		s.log.Error("room delete failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be deleted. Try again.")
		return
	}
	// Durable row gone; the hub still holds everything live about it (#618).
	if s.presence != nil {
		s.presence.CloseRoom(room.Slug)
	}
	// A crew with no rooms left is still a crew (#1236): its members stay,
	// and its owner opens the next room in it.
	s.log.Info("room deleted", "room", room.Slug)
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
