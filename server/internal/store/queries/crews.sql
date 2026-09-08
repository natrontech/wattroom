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
--
-- Always through makeOwner in Go, never alone: the new owner's crew_roles row
-- has to go with it (#1212). Owner beats every role in CrewRoleOf, but
-- visible_rooms and IsBannedFromRoom read the row without asking who owns
-- the crew, so a banned row left on an owner locks them out of their rooms.
update crews set owner_id = $2 where id = $1;

-- name: CountRoomsOwnedInCrew :one
-- A room never leaves its crew, so its owner cannot be banned from it (#1212):
-- the ban would orphan the room, and the successor of last resort could then
-- hand the crew to someone it banned.
select count(*) from rooms where crew_id = $1 and owner_id = $2;

-- name: GrantRoomAccess :exec
insert into room_grants (room_id, user_id) values ($1, $2)
on conflict (room_id, user_id) do nothing;

-- name: CanEnterRoom :one
select exists (
    select 1 from visible_rooms where user_id = $1 and room_id = $2
)::boolean;

-- name: IsBannedFromRoom :one
-- BOTH levels in one answer (ADR-0038, third amendment). A room ban lives on
-- the membership row; a crew ban lives on crew_roles and reaches every room in
-- the crew. Every door asks this one question rather than each remembering
-- there are two — which is the whole lesson of #1109 and #1114, where four
-- separate joins each wrote the single-level guard by hand and one omitted it.
select (
    exists (
        select 1 from memberships m
        where m.room_id = sqlc.arg(room_id) and m.user_id = sqlc.arg(user_id)
          and m.role = 'banned'
    )
    or exists (
        select 1 from crew_roles cr
        join rooms r on r.crew_id = cr.crew_id
        where r.id = sqlc.arg(room_id) and cr.user_id = sqlc.arg(user_id)
          and cr.role = 'banned'
    )
)::boolean;

-- name: GetCrewOwnedBy :one
-- The crew a room is created into. One crew per owner, made with their first
-- room and named after them — the migration's rule, applied to accounts that
-- arrive after it. ponytail: a rider owns one crew; choosing a crew on room
-- creation is the upgrade if a second one is ever wanted.
select * from crews where owner_id = $1 order by created_at limit 1;

-- name: PlaceRoomInCrew :exec
-- Crewless rooms are forbidden in code from the cutover (ADR-0038). A
-- separate statement rather than a wider CreateRoom: fifteen call sites make
-- rooms directly and none of them is a creation path a rider can reach.
update rooms set crew_id = $2, crew_visible = $3 where id = $1;

-- name: UpdateCrew :one
update crews set name = $2, icon = $3 where id = $1 returning *;

-- name: ListCrewsOwnedBy :many
select * from crews where owner_id = $1 order by created_at;

-- name: DeleteCrew :exec
delete from crews where id = $1;

-- name: DeleteRoomsOwnedBy :exec
-- The purge's first step, done explicitly rather than left to the cascade so
-- the crew's fate is decided by the rooms that REMAIN (ADR-0038, second
-- amendment): a crew holding only the departing owner's rooms has nothing
-- left to own, one holding other people's rooms transfers.
delete from rooms where owner_id = $1;

-- name: ListCrewRoomSlugs :many
select slug from rooms where crew_id = $1;

-- name: CrewRoleOf :one
-- One word for what a person is to a crew. Owner beats everything (they
-- cannot be banned — ADR-0038's second amendment), a ban beats an admin row
-- that was never cleared, and membership is derived from the rooms.
select case
    when c.owner_id = sqlc.arg(user_id) then 'owner'
    when exists (select 1 from crew_roles cr
                 where cr.crew_id = c.id and cr.user_id = sqlc.arg(user_id) and cr.role = 'banned') then 'banned'
    when exists (select 1 from crew_roles cr
                 where cr.crew_id = c.id and cr.user_id = sqlc.arg(user_id) and cr.role = 'admin') then 'admin'
    when exists (select 1 from memberships m join rooms r on r.id = m.room_id
                 where r.crew_id = c.id and m.user_id = sqlc.arg(user_id) and m.role <> 'banned') then 'member'
    else ''
end::text
from crews c where c.id = sqlc.arg(crew_id);

-- name: ListCrewRoles :many
select * from crew_roles where crew_id = $1;

-- name: ListCrewPeople :many
-- The crew's people, once each (ADR-0038: crew membership follows room
-- membership). A crew ban takes a person off this list even while their room
-- rows stand — they are on the banned list instead.
--
-- Person-visibility follows the rooms the VIEWER may enter (#1135), so a
-- plain member sees the crew-mates they share an enterable room with and
-- nobody from a private room they are outside of — `everyone` is false and
-- the join is narrowed to visible_rooms. The owner and admins act on people
-- by id (a ban, an admin grant), so for them it is true and the list is the
-- whole crew.
select u.id, u.display_name, u.avatar_url, u.avatar_preset,
       min(m.joined_at)::timestamptz as since,
       count(distinct m.room_id)::bigint as room_count,
       -- Owns a room here, so cannot be crew-banned (#1212): the menu says so
       -- instead of offering a ban that 409s.
       bool_or(m.role = 'owner')::boolean as owns_room
from memberships m
join rooms r on r.id = m.room_id
join users u on u.id = m.user_id
where r.crew_id = sqlc.arg(crew_id) and m.role <> 'banned'
  and (sqlc.arg(everyone)::boolean
       or exists (select 1 from visible_rooms v
                  where v.room_id = r.id and v.user_id = sqlc.arg(viewer)))
  and not exists (select 1 from crew_roles cr
                  where cr.crew_id = r.crew_id and cr.user_id = u.id and cr.role = 'banned')
group by u.id
order by min(m.joined_at);

-- name: ListCrewBanned :many
select u.id, u.display_name, u.avatar_url, u.avatar_preset, cr.set_at
from crew_roles cr
join users u on u.id = cr.user_id
where cr.crew_id = $1 and cr.role = 'banned'
order by cr.set_at;

-- name: ListCrewBans :many
select user_id from crew_roles where crew_id = $1 and role = 'banned';

-- name: ListCrewRoomsFor :many
-- The crew's rooms you hold NO membership in, for the sidebar (#1149): a
-- crew's list carries rooms you cannot enter and rooms you administer
-- without reading, and a row has to say which without being opened.
-- `enterable` is asked of visible_rooms and nowhere else (ADR-0038, third
-- amendment). A room ban keeps you off this list entirely — a banned
-- membership row is still a row — and so does a crew ban.
with mine as (
    select r.crew_id from memberships m join rooms r on r.id = m.room_id
    where m.user_id = sqlc.arg(user_id) and m.role <> 'banned' and r.crew_id is not null
    union
    select cr.crew_id from crew_roles cr where cr.user_id = sqlc.arg(user_id) and cr.role = 'admin'
    union
    select c.id from crews c where c.owner_id = sqlc.arg(user_id)
)
select r.id, r.slug, r.name, r.icon, r.crew_visible, r.crew_id,
       c.name as crew_name, c.icon as crew_icon, c.owner_id as crew_owner_id,
       exists (select 1 from visible_rooms v
               where v.room_id = r.id and v.user_id = sqlc.arg(user_id))::boolean as enterable,
       (c.owner_id = sqlc.arg(user_id) or exists (select 1 from crew_roles cr
               where cr.crew_id = c.id and cr.user_id = sqlc.arg(user_id) and cr.role = 'admin'))::boolean as administers
from rooms r
join crews c on c.id = r.crew_id
where r.crew_id in (select crew_id from mine)
  and not exists (select 1 from memberships m where m.room_id = r.id and m.user_id = sqlc.arg(user_id))
  and not exists (select 1 from crew_roles cr
                  where cr.crew_id = r.crew_id and cr.user_id = sqlc.arg(user_id) and cr.role = 'banned')
order by r.created_at;

-- name: PickCrewSuccessor :one
-- docs/SPEC.md's succession rule: the longest-standing admin, else the
-- longest-standing member, among the people in the crew's remaining rooms;
-- never the departing owner, never anyone the crew banned. No row means
-- nobody is left and the crew is deleted rather than left ownerless.
select m.user_id
from memberships m
join rooms r on r.id = m.room_id
where r.crew_id = sqlc.arg(crew_id) and m.user_id <> sqlc.arg(departing) and m.role <> 'banned'
  and not exists (select 1 from crew_roles cr
                  where cr.crew_id = r.crew_id and cr.user_id = m.user_id and cr.role = 'banned')
group by m.user_id
order by exists (select 1 from crew_roles cr
                 where cr.crew_id = sqlc.arg(crew_id) and cr.user_id = m.user_id and cr.role = 'admin') desc,
         min(m.joined_at)
limit 1;

-- name: CountCrewMembershipsOf :one
-- Is this person still IN the crew — a live membership in any of its rooms.
select count(*) from memberships m join rooms r on r.id = m.room_id
where r.crew_id = $1 and m.user_id = $2 and m.role <> 'banned';

-- name: FirstRoomOwnerInCrew :one
-- The successor of last resort: PickCrewSuccessor can come back empty while
-- rooms remain (their owners crew-banned, say), and the rule must always name
-- somebody while there is a room to own. A room always has an owner.
select owner_id from rooms where crew_id = $1 and owner_id <> $2 order by created_at limit 1;
