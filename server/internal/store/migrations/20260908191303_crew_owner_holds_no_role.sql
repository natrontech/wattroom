-- +goose Up
-- Ownership beats every crew role (ADR-0038, second amendment): the owner
-- cannot be banned or demoted, and CrewRoleOf answers "owner" before it reads
-- crew_roles at all. visible_rooms and IsBannedFromRoom do not ask who owns
-- the crew, so a banned row left on an owner — set before the owner guard
-- existed, or inherited by the successor of last resort — locked them out of
-- every room they own with nothing on any screen to say why (#1212).
--
-- From this release on, becoming owner clears the row (makeOwner) and a room
-- owner cannot be banned from the crew their room is in. This removes the
-- contradictions already stored. Data only; nothing to contract later.
delete from crew_roles cr using crews c where c.id = cr.crew_id and c.owner_id = cr.user_id;

-- +goose Down
-- Nothing to restore: the rows contradicted the owner they were set on.
select 1;
