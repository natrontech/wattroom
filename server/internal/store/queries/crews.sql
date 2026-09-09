-- The crew (ADR-0038, #1106; amended #1236). Crew membership is a row in
-- crew_roles — member, admin or banned — written by the crew's door (JoinCrew)
-- and read by everything else. The owner is crews.owner_id and holds no row.

-- name: CreateCrew :one
insert into crews (name, owner_id, code) values ($1, $2, $3) returning *;

-- name: GetCrewByCode :one
-- The crew's door (#1236). A code is a secret: the caller learns the crew it
-- names and nothing about codes that do not exist.
select id, name, icon, owner_id, created_at, code, (image_set_at is not null)::boolean as has_image from crews where code = $1;

-- name: JoinCrew :exec
-- Stored membership (ADR-0038 amended, #1236). A banned or admin row wins the
-- conflict: joining never lifts a ban and never demotes an admin.
insert into crew_roles (crew_id, user_id, role) values ($1, $2, 'member')
on conflict (crew_id, user_id) do nothing;

-- name: LeaveCrewRole :exec
-- Leaving takes the member or admin row, never a ban.
delete from crew_roles where crew_id = $1 and user_id = $2 and role <> 'banned';

-- name: LeaveCrewRooms :exec
-- ...and every room membership in the crew, in one statement.
delete from memberships m using rooms r
where r.id = m.room_id and r.crew_id = $1 and m.user_id = $2 and m.role <> 'banned';

-- name: CountCrewMembers :one
select 1 + count(*) from crew_roles where crew_id = $1 and role in ('member', 'admin');

-- name: GetCrew :one
-- Everything but the image bytes (#1237): GetCrewImage serves those.
select id, name, icon, owner_id, created_at, code, (image_set_at is not null)::boolean as has_image from crews where id = $1;

-- name: SetCrewRole :exec
-- Admin, member or banned. The owner is crews.owner_id and cannot be expressed here,
-- which is what makes them un-removable (ADR-0038, second amendment).
insert into crew_roles (crew_id, user_id, role) values ($1, $2, $3)
on conflict (crew_id, user_id) do update set role = excluded.role, set_at = now();

-- name: ClearCrewRole :exec
-- The new owner's row goes (crews.owner_id is their role now); nothing else
-- clears a row — a member's row IS their membership (#1236).
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
-- The named exception into a private room (ADR-0038, #1224): a door, not a
-- membership — the person still walks in themselves.
insert into room_grants (room_id, user_id) values ($1, $2)
on conflict (room_id, user_id) do nothing;

-- name: RevokeRoomAccess :exec
delete from room_grants where room_id = $1 and user_id = $2;

-- name: ListRoomGrantees :many
-- People let into a private room who have not walked in yet. A grant is moot
-- once they join — membership admits — so joined people drop off this list.
select u.id, u.display_name, u.avatar_url, g.granted_at
from room_grants g
join users u on u.id = g.user_id
where g.room_id = $1
  and not exists (select 1 from memberships m where m.room_id = g.room_id and m.user_id = g.user_id)
order by g.granted_at;

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
-- The crew a room is created into when the caller names none (#1201). One
-- crew per owner, made with their first room and named after them — the
-- migration's rule, applied to accounts that arrive after it.
select * from crews where owner_id = $1 order by created_at limit 1;

-- name: PlaceRoomInCrew :exec
-- Crewless rooms are forbidden in code from the cutover (ADR-0038). A
-- separate statement rather than a wider CreateRoom: fifteen call sites make
-- rooms directly and none of them is a creation path a rider can reach.
update rooms set crew_id = $2, crew_visible = $3 where id = $1;

-- name: UpdateCrew :one
update crews set name = $2, icon = $3 where id = $1 returning *;

-- name: SetCrewImage :exec
update crews set image_mime = $2, image = $3, image_set_at = now() where id = $1;

-- name: ClearCrewImage :exec
update crews set image_mime = null, image = null, image_set_at = null where id = $1;

-- name: GetCrewImage :one
-- The blob alone: GetCrew selects * and every crew read would otherwise carry
-- up to 2 MB it never shows.
select image_mime, image, image_set_at from crews where id = $1 and image is not null;

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
-- cannot be banned — ADR-0038's second amendment); every other word is the
-- row (#1236: membership is stored, not derived from the rooms).
select case
    when c.owner_id = sqlc.arg(user_id) then 'owner'
    else coalesce((select cr.role from crew_roles cr
                   where cr.crew_id = c.id and cr.user_id = sqlc.arg(user_id)), '')
end::text
from crews c where c.id = sqlc.arg(crew_id);

-- name: ListCrewRoles :many
select * from crew_roles where crew_id = $1;

-- name: ListCrewPeople :many
-- The crew's people (#1236: the owner plus every member and admin row), each
-- with how many of the crew's rooms hold them and whether they own one there.
--
-- Person-visibility follows the rooms the VIEWER may enter (#1135): a plain
-- member sees the crew-mates they share an enterable room with (and
-- themselves); the owner and admins act on people by id, so for them
-- `everyone` is true and the list is the whole crew.
with people as (
    select c.owner_id as user_id, c.created_at as since from crews c where c.id = sqlc.arg(crew_id)
    union all
    select cr.user_id, cr.set_at from crew_roles cr
    where cr.crew_id = sqlc.arg(crew_id) and cr.role in ('member', 'admin')
)
select u.id, u.display_name, u.avatar_url,
       p.since::timestamptz as since,
       (select count(*) from memberships m join rooms r on r.id = m.room_id
         where r.crew_id = sqlc.arg(crew_id) and m.user_id = u.id and m.role <> 'banned')::bigint as room_count,
       exists (select 1 from memberships m join rooms r on r.id = m.room_id
                where r.crew_id = sqlc.arg(crew_id) and m.user_id = u.id and m.role = 'owner')::boolean as owns_room
from people p
join users u on u.id = p.user_id
where sqlc.arg(everyone)::boolean
   or u.id = sqlc.arg(viewer)
   or exists (select 1 from memberships m
              join rooms r on r.id = m.room_id
              join visible_rooms v on v.room_id = r.id and v.user_id = sqlc.arg(viewer)
              where r.crew_id = sqlc.arg(crew_id) and m.user_id = u.id and m.role <> 'banned')
order by p.since;

-- name: ListCrewBanned :many
select u.id, u.display_name, u.avatar_url, cr.set_at
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
    select cr.crew_id from crew_roles cr where cr.user_id = sqlc.arg(user_id) and cr.role in ('member', 'admin')
    union
    select c.id from crews c where c.owner_id = sqlc.arg(user_id)
)
select r.id, r.slug, r.name, r.icon, r.crew_visible, r.crew_id,
       c.name as crew_name, c.icon as crew_icon, c.owner_id as crew_owner_id,
       (c.image_set_at is not null)::boolean as crew_has_image,
       coalesce(c.code, '')::text as crew_code,
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
-- longest-standing member (#1236: the rows, not the rooms); never the
-- departing owner, never anyone the crew banned. No row means nobody is left
-- and the crew is deleted rather than left ownerless.
select cr.user_id
from crew_roles cr
where cr.crew_id = sqlc.arg(crew_id) and cr.user_id <> sqlc.arg(departing) and cr.role in ('admin', 'member')
order by (cr.role = 'admin') desc, cr.set_at
limit 1;

-- name: FirstRoomOwnerInCrew :one
-- The successor of last resort: PickCrewSuccessor can come back empty while
-- rooms remain (their owners crew-banned, say), and the rule must always name
-- somebody while there is a room to own. A room always has an owner.
select owner_id from rooms where crew_id = $1 and owner_id <> $2 order by created_at limit 1;

-- name: GetRoomInCrew :one
-- A room addressed by id inside its crew (#1226): the crew page holds no slug
-- for a room the caller may not enter (#1205), and the one thing a crew admin
-- may do to such a room is set who may.
select * from rooms where id = $1 and crew_id = $2;

-- name: SetRoomCrewVisible :exec
-- The one permission a crew admin holds over a room they never joined
-- (ADR-0038: "crew admins manage room permissions"). Nothing else on the row.
update rooms set crew_visible = $2 where id = $1;
