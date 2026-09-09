package rooms

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A private room's named exceptions (ADR-0038; #1224). A grant is a door,
// not a membership: the crew-mate sees the room in their sidebar and may walk
// in, and they still join themselves — WATTROOM.md shows metrics to people
// who actually join, and being let in is not joining. Once they are in, the
// membership admits them and the grant is moot.

func (s *Service) registerGrants(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/rooms/{slug}/grants", s.handleGrant)
	mux.HandleFunc("DELETE /api/rooms/{slug}/grants/{userID}", s.handleRevoke)
}

// handleGrant lets a crew-mate into a private room. Owner only, per the
// matrix. The target has to be in the crew — a grant is the exception to
// "open to the crew", not a second invite path around the crew's — and
// banned at neither level: a ban beats a grant in visible_rooms, so granting
// a banned person would do nothing and look like it did.
func (s *Service) handleGrant(w http.ResponseWriter, r *http.Request) {
	room, _, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	var req struct {
		UserID string `json:"userId"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	target, err := store.ParseUUID(req.UserID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a user id.", "userId")
		return
	}
	if !room.CrewID.Valid {
		httpx.WriteError(w, http.StatusConflict, "conflict", "This room is not in a crew yet.")
		return
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: room.CrewID, UserID: target})
	if err != nil {
		s.log.Error("crew role lookup failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That did not work. Try again.")
		return
	}
	switch role {
	case "":
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"Letting in is for crew-mates — they have to be in one of the crew's rooms first. Share the code instead.")
		return
	case "banned":
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"They are banned from the crew, and a crew ban beats a door. Lift it first if you mean it.")
		return
	}
	banned, err := s.store.Queries.IsBannedFromRoom(r.Context(), db.IsBannedFromRoomParams{RoomID: room.ID, UserID: target})
	if err != nil || banned {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"They are banned from this room. Unban them first if you mean it.")
		return
	}
	if err := s.store.Queries.GrantRoomAccess(r.Context(), db.GrantRoomAccessParams{RoomID: room.ID, UserID: target}); err != nil {
		s.log.Error("grant failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That did not work. Try again.")
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}

// handleRevoke takes a door back before it was used. Revoking a member's
// grant is a no-op by design: they are in by their membership now, and
// removing them is the owner's remove, not this.
func (s *Service) handleRevoke(w http.ResponseWriter, r *http.Request) {
	room, _, ok := s.requireRole(w, r, "owner")
	if !ok {
		return
	}
	target, err := store.ParseUUID(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That is not a user id.")
		return
	}
	if err := s.store.Queries.RevokeRoomAccess(r.Context(), db.RevokeRoomAccessParams{RoomID: room.ID, UserID: target}); err != nil {
		s.log.Error("revoke failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That did not work. Try again.")
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}

// exceptions is the owner's view of a private room's door list: who has been
// let in and has not walked in yet, and which crew-mates are outside. The
// second list is narrowed to the people the owner can already see
// (person-visibility follows the rooms they may enter, #1135) — a room owner
// is not a super-reader of the crew. Soft-fails to empty like the other
// owner-only reads: a door list that cannot be loaded is a section that does
// not render, never a room that will not open.
func (s *Service) exceptions(ctx context.Context, room db.Room, owner db.User, members []db.ListRoomMembersRow) (invited, outside []memberJSON) {
	inRoom := map[pgtype.UUID]bool{owner.ID: true}
	for _, m := range members {
		inRoom[m.ID] = true
	}
	grantees, err := s.store.Queries.ListRoomGrantees(ctx, room.ID)
	if err != nil {
		s.log.Warn("list grantees failed", "err", err, "room", room.Slug)
		return nil, nil
	}
	for _, g := range grantees {
		inRoom[g.ID] = true
		invited = append(invited, memberJSON{
			ID: store.UUIDString(g.ID), DisplayName: g.DisplayName,
			AvatarURL: g.AvatarUrl, Role: "invited",
			JoinedAt: g.GrantedAt.Time.Format("2006-01-02"),
		})
	}
	people, err := s.store.Queries.ListCrewPeople(ctx, db.ListCrewPeopleParams{
		CrewID: room.CrewID, Everyone: false, Viewer: owner.ID,
	})
	if err != nil {
		s.log.Warn("list crew people failed", "err", err, "room", room.Slug)
		return invited, nil
	}
	for _, p := range people {
		if inRoom[p.ID] {
			continue
		}
		outside = append(outside, memberJSON{
			ID: store.UUIDString(p.ID), DisplayName: p.DisplayName,
			AvatarURL: p.AvatarUrl, Role: "crew",
		})
	}
	return invited, outside
}
