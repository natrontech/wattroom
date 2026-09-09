package rooms

import (
	"errors"
	"net/http"

	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Who is in a room: the door, roles, removal, bans, and handing the room on.
// Split from rooms.go (#1265).

func (s *Service) handleJoin(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to join a room.")
	if !ok {
		return
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	if s.isBanned(r, room, user) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", bannedRefusal)
		return
	}
	// The slug is a name, not a door (#1236): entering needs the right to,
	// which visible_rooms answers — crew membership at an open room, a grant
	// at a private one. A listed room (ADR-0039) is the one public door, and
	// it opens onto the crew: joining it joins the crew first.
	can, err := s.store.Queries.CanEnterRoom(r.Context(), db.CanEnterRoomParams{UserID: user.ID, RoomID: room.ID})
	if err != nil {
		s.log.Error("enter check failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
		return
	}
	if !can {
		if !room.Listed || !room.CrewID.Valid {
			httpx.WriteError(w, http.StatusForbidden, "forbidden",
				"This room is in a crew you are not in. Ask for the crew's invite link.")
			return
		}
		if err := s.store.Queries.JoinCrew(r.Context(), db.JoinCrewParams{CrewID: room.CrewID, UserID: user.ID}); err != nil {
			s.log.Error("crew join via listed room failed", "err", err, "room", room.Slug)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
			return
		}
	}
	// Idempotent by design (ON CONFLICT DO NOTHING): joining twice is a no-op,
	// and an existing role is never downgraded to member by a re-join.
	err = s.store.Queries.CreateMembership(r.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: user.ID, Role: "member",
	})
	if err != nil {
		s.log.Error("join failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Joining did not work. Try again.")
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}

// bannedRefusal is what a banned rider hears at every door they try.
const bannedRefusal = "The owner removed you from this room."

// isBanned is the gate at every door: a ban survives every re-join path
// because the membership row itself carries it, and since ADR-0038 a crew ban
// reaches the same doors from one level up.
//
// Both levels are asked as ONE question (IsBannedFromRoom) rather than each
// caller remembering there are two. #1109 and #1114 were four separate joins
// that each wrote the single-level guard by hand, and one of them omitted it;
// a second level doubles that surface unless there is a single place to ask.
//
// Fails CLOSED. A lookup error here means "banned" — the alternative is
// admitting someone to a room because the database hiccuped, and a ban is the
// one answer that must not degrade towards yes.
func (s *Service) isBanned(r *http.Request, room db.Room, user db.User) bool {
	banned, err := s.store.Queries.IsBannedFromRoom(r.Context(), db.IsBannedFromRoomParams{
		RoomID: room.ID, UserID: user.ID,
	})
	if err != nil {
		s.log.Error("ban check failed", "err", err, "room", room.Slug)
		return true
	}
	return banned
}

// handleSetRole: owner assigns or removes coach, bans, unbans (matrix:
// owner-only). A ban also severs the target's live sockets and voice.
func (s *Service) handleSetRole(w http.ResponseWriter, r *http.Request) {
	room, owner, ok := s.requireRole(w, r, "owner")
	if !ok {
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
	if req.Role != "coach" && req.Role != "member" && req.Role != "banned" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A role is coach, member or banned — ownership does not transfer here.", "role")
		return
	}
	target, err := store.ParseUUID(req.UserID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a user id.", "userId")
		return
	}
	if store.UUIDString(target) == store.UUIDString(owner.ID) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"You are the owner — that role does not change here.")
		return
	}
	changed, err := s.store.Queries.UpdateMembershipRole(r.Context(), db.UpdateMembershipRoleParams{
		RoomID: room.ID, UserID: target, Role: req.Role,
	})
	if err != nil {
		s.log.Error("role update failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The role could not be changed.")
		return
	}
	if changed == 0 {
		// The row count is the answer (audit 2026-09-09): 204 for a row that
		// was never there sent an eviction ping for nothing.
		httpx.WriteError(w, http.StatusNotFound, "not_found", "They are not in this room.")
		return
	}
	if req.Role == "banned" {
		s.evict(room.Slug, req.UserID)
		s.log.Info("member banned", "room", room.Slug, "rider", req.UserID)
	} else if s.presence != nil {
		s.presence.SetRole(room.Slug, req.UserID, req.Role)
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}

// handleRemoveMember: the owner removes anyone; anyone removes themselves
// (leaving). The owner cannot leave — a room without an owner has nobody who
// can edit or delete it, so ownership transfer is a future feature, not an
// accident of leaving.
func (s *Service) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	target, err := store.ParseUUID(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That is not a user id.")
		return
	}

	self := store.UUIDString(target) == store.UUIDString(user.ID)
	if !self {
		if _, _, ok := s.requireRole(w, r, "owner"); !ok {
			return
		}
	} else if s.isBanned(r, room, user) {
		// Leaving is not a way out of a ban (#637): the banned row is what
		// keeps the rejoin doors shut, so the rider does not get to delete it.
		httpx.WriteError(w, http.StatusForbidden, "forbidden", bannedRefusal)
		return
	}
	if room.OwnerID == target {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"The owner cannot leave their own room.")
		return
	}
	removed, err := s.store.Queries.DeleteMembership(r.Context(), db.DeleteMembershipParams{
		RoomID: room.ID, UserID: target,
	})
	if err != nil {
		s.log.Error("remove member failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That did not work. Try again.")
		return
	}
	if removed == 0 {
		// The query keeps a banned row on purpose (#637); the owner clicking
		// Remove on one used to get a 204 for a delete that did nothing.
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"They are not in this room — a banned rider is unbanned, not removed.")
		return
	}
	// Leaving or being removed ends the live connection too — a socket whose
	// membership is gone must not keep streaming until it happens to close.
	s.evict(room.Slug, store.UUIDString(target))
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}

// handleTransferRoom hands the room to one of its members (#1227). Until now
// ownership did not move at all, and rooms.owner_id cascades: the day an
// owner deleted their account the room went with it — its chat, medals and
// plan, for everyone in it — which since ADR-0038 is a group's place inside a
// crew, often opened by an admin (#1201). The old owner becomes a coach: they
// were running it a moment ago. The new owner's cap binds (docs/SPEC.md).
func (s *Service) handleTransferRoom(w http.ResponseWriter, r *http.Request) {
	room, owner, ok := s.requireRole(w, r, "owner")
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
	if target == owner.ID {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "You already own this room.")
		return
	}
	m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{RoomID: room.ID, UserID: target})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.log.Error("transfer membership check failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The hand-over did not go through. Try again.")
		return
	}
	if err != nil || m.Role == "banned" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A room passes to one of its members — they have to be in here, and not banned.")
		return
	}
	// Each check answers for itself (audit 2026-09-09): a database failure
	// is a 500 and a log line, never "they are banned" or a cap waved through.
	banned, err := s.store.Queries.IsBannedFromRoom(r.Context(), db.IsBannedFromRoomParams{RoomID: room.ID, UserID: target})
	if err != nil {
		s.log.Error("transfer ban check failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The hand-over did not go through. Try again.")
		return
	}
	if banned {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"They are banned from the crew this room is in. Lift that first if you mean it.")
		return
	}
	owned, err := s.store.Queries.CountOwnedRooms(r.Context(), target)
	if err != nil {
		s.log.Error("transfer cap check failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The hand-over did not go through. Try again.")
		return
	}
	if owned >= maxOwnedRooms {
		httpx.WriteError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("They already own %d rooms — the cap. They would have to delete one first.", maxOwnedRooms))
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.log.Error("room transfer begin failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be handed on.")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	err = q.TransferRoom(r.Context(), db.TransferRoomParams{ID: room.ID, OwnerID: target})
	if err == nil {
		_, err = q.UpdateMembershipRole(r.Context(), db.UpdateMembershipRoleParams{RoomID: room.ID, UserID: target, Role: "owner"})
	}
	if err == nil {
		_, err = q.UpdateMembershipRole(r.Context(), db.UpdateMembershipRoleParams{RoomID: room.ID, UserID: owner.ID, Role: "coach"})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.log.Error("room transfer failed", "err", err, "room", room.Slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The room could not be handed on.")
		return
	}
	if s.presence != nil {
		s.presence.SetRole(room.Slug, req.UserID, "owner")
		s.presence.SetRole(room.Slug, store.UUIDString(owner.ID), "coach")
	}
	s.log.Info("room handed on", "room", room.Slug, "from", store.UUIDString(owner.ID), "to", req.UserID)
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
