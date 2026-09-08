-- The crew (ADR-0038, #1106). Crew membership is derived from room membership
-- and is deliberately not stored, so there is no CreateCrewMembership here —
-- only the two facts room membership cannot imply: an admin grant and a ban.

-- name: CreateCrew :one
insert into crews (name, owner_id) values ($1, $2) returning *;

-- name: GetCrew :one
select * from crews where id = $1;

-- name: SetCrewRole :exec
-- Admin or banned. The owner is crews.owner_id and cannot be expressed here,
-- which is what makes them un-removable (ADR-0038, second amendment).
insert into crew_roles (crew_id, user_id, role) values ($1, $2, $3)
on conflict (crew_id, user_id) do update set role = excluded.role, set_at = now();

-- name: ClearCrewRole :exec
delete from crew_roles where crew_id = $1 and user_id = $2;

-- name: TransferCrew :exec
-- Ownership transfers, deliberately and on account deletion (ADR-0038, second
-- amendment). crews.owner_id is ON DELETE RESTRICT, so the purge path MUST run
-- this before deleting a user or the deletion fails loudly — which is the
-- intended behaviour, not a bug to work around.
update crews set owner_id = $2 where id = $1;

-- name: GrantRoomAccess :exec
insert into room_grants (room_id, user_id) values ($1, $2)
on conflict (room_id, user_id) do nothing;

-- name: RevokeRoomAccess :exec
delete from room_grants where room_id = $1 and user_id = $2;

-- name: RoomsVisibleTo :many
-- THE gate. Every call site that needs "which rooms may this person enter"
-- selects from the view and never re-derives it (ADR-0038, third amendment).
select room_id from visible_rooms where user_id = $1;

-- name: CanEnterRoom :one
select exists (
    select 1 from visible_rooms where user_id = $1 and room_id = $2
)::boolean;
