package rooms

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Who owns the crew, and how that changes: succession on the purge path,
// the deliberate hand-over, and makeOwner as the one way it moves
// (ADR-0038, second amendment). Split from crews.go (#1234).

// releaseCrew hands the crew on or removes it, never leaving it ownerless:
// docs/SPEC.md's successor first, any remaining room's owner as the last
// resort, and deletion only once no room is left to own. The departing
// owner's own rooms must already be gone.
func (s *Service) releaseCrew(ctx context.Context, q *db.Queries, crew db.Crew) error {
	next, err := q.PickCrewSuccessor(ctx, db.PickCrewSuccessorParams{CrewID: crew.ID, Departing: crew.OwnerID})
	if errors.Is(err, pgx.ErrNoRows) {
		next, err = q.FirstRoomOwnerInCrew(ctx, db.FirstRoomOwnerInCrewParams{CrewID: crew.ID, OwnerID: crew.OwnerID})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if err := q.DeleteCrew(ctx, crew.ID); err != nil {
			return err
		}
		s.log.Info("crew deleted", "crew", store.UUIDString(crew.ID))
		return nil
	}
	if err != nil {
		return err
	}
	if err := makeOwner(ctx, q, crew.ID, next); err != nil {
		return err
	}
	s.log.Info("crew transferred", "crew", store.UUIDString(crew.ID), "to", store.UUIDString(next))
	return nil
}

// makeOwner is the only way a crew changes hands. Owner beats every role, so
// the new owner's crew_roles row — an admin grant at best, a stale ban at
// worst — goes with the transfer (#1212): visible_rooms and IsBannedFromRoom
// read that table without asking who owns the crew, and a banned row on an
// owner locks them out of every room they own.
func makeOwner(ctx context.Context, q *db.Queries, crew, next pgtype.UUID) error {
	if err := q.TransferCrew(ctx, db.TransferCrewParams{ID: crew, OwnerID: next}); err != nil {
		return err
	}
	return q.ClearCrewRole(ctx, db.ClearCrewRoleParams{CrewID: crew, UserID: next})
}

// ReleaseCrews is the purge's obligation (ADR-0038, second amendment):
// crews.owner_id is ON DELETE RESTRICT, so an account that owns a crew cannot
// be deleted until each crew has been handed on or, with no rooms left,
// removed. Runs inside the purge's transaction, after the caller has deleted
// the rooms the departing rider owns, so what remains is what decides.
func (s *Service) ReleaseCrews(ctx context.Context, q *db.Queries, user pgtype.UUID) error {
	crews, err := q.ListCrewsOwnedBy(ctx, user)
	if err != nil {
		return err
	}
	for _, crew := range crews {
		if err := s.releaseCrew(ctx, q, crew); err != nil {
			return err
		}
	}
	return nil
}

// handleTransferCrew: the deliberate hand-over ADR-0038's second amendment
// asks for, so the only way to pass a crew on is not deleting your account.
// Owner only; the target must be in the crew and not banned from it. The old
// owner stays on as an admin — they were running it a moment ago, and taking
// that away is one click if the new owner means to — and the new owner's own
// row goes, since owner beats it (makeOwner).
func (s *Service) handleTransferCrew(w http.ResponseWriter, r *http.Request) {
	crew, actor, role, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	if role != "owner" {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Only the crew's owner can hand it on.")
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
	if target == actor.ID {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "You already own this crew.")
		return
	}
	switch targetRole, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: target}); {
	case err != nil:
		s.log.Error("crew role lookup failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be handed on.")
		return
	case targetRole == "banned":
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"They are banned from this crew. Lift the ban first if you mean it.")
		return
	case targetRole == "":
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A crew passes to someone already in it — they have to join by its code first.")
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.log.Error("crew transfer begin failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be handed on.")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	err = makeOwner(r.Context(), q, crew.ID, target)
	if err == nil {
		err = q.SetCrewRole(r.Context(), db.SetCrewRoleParams{CrewID: crew.ID, UserID: actor.ID, Role: "admin"})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.log.Error("crew transfer failed", "err", err, "crew", store.UUIDString(crew.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The crew could not be handed on.")
		return
	}
	s.log.Info("crew handed on", "crew", store.UUIDString(crew.ID), "from", store.UUIDString(actor.ID), "to", req.UserID)
	s.changed()
	httpx.WriteJSON(w, http.StatusOK, roomCrewJSON{
		Id: store.UUIDString(crew.ID), Name: crew.Name, Icon: crew.Icon, Role: "admin",
	})
}
