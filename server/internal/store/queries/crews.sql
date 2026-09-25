-- The crew (ADR-0038, #1106; amended #1236). Crew membership is a row in
-- crew_roles — member, admin or banned — written by the crew's door (JoinCrew)
-- and read by everything else. The owner is crews.owner_id and holds no row.
--
-- No `*` on crews (#2733): sqlc expands it into the generated SQL, so a
-- column stays named in a release's binary for as long as any `*` read it,
-- and a later drop breaks the rollback to that release. The four reads below
-- list their columns, which is how `cheers` could leave (#2784, then #2733's
-- drop); a column added to crews is added to them by hand.

-- name: CreateCrew :one
-- Founded by its first owner (#1928): what "your own crew" means after a
-- hand-over, when a rider may own more than one.
insert into crews (name, owner_id, code, founded_by) values ($1, $2, $3, $2)
returning id, name, icon, owner_id, created_at, code, image_mime, image, image_set_at,
       renamed_at, founded_by, board_enabled, listed, ics_token;

-- name: FoundCrew :one
-- A crew a rider starts by name (#2480). The name is a person's from the
-- first moment, so the day-one naming step (#1151) never opens for it.
insert into crews (name, owner_id, code, founded_by, renamed_at)
values ($1, $2, $3, $2, now())
returning id, name, icon, owner_id, created_at, code, image_mime, image, image_set_at,
       renamed_at, founded_by, board_enabled, listed, ics_token;

-- name: CountFoundedCrews :one
-- docs/SPEC.md's founding cap counts the crews a rider founded AND still
-- owns: deleting one or handing it on frees the slot.
select count(*) from crews where founded_by = $1 and owner_id = $1;

-- name: GetCrewByCode :one
-- The crew's door (#1236). A code is a secret: the caller learns the crew it
-- names and nothing about codes that do not exist.
select id, name, icon, owner_id, created_at, code, (image_set_at is not null)::boolean as has_image, (renamed_at is not null)::boolean as named, board_enabled from crews where code = $1;

-- name: JoinCrew :exec
-- Stored membership (ADR-0038 amended, #1236). A banned or admin row wins the
-- conflict: joining never lifts a ban and never demotes an admin.
insert into crew_roles (crew_id, user_id, role) values ($1, $2, 'member')
on conflict (crew_id, user_id) do nothing;

-- name: LeaveCrewRole :exec
-- Leaving takes the member or admin row, never a ban.
delete from crew_roles where crew_id = $1 and user_id = $2 and role <> 'banned';

-- name: CountCrewMembers :one
-- The owner, plus every member and admin — never the owner twice: a stray
-- member row for the owner (#1671) is skipped here as ListCrewPeople skips
-- it, or the door said one more than the roster showed (#1932).
select 1 + count(*) from crew_roles
where crew_id = $1 and role in ('member', 'admin')
  and user_id <> (select owner_id from crews where id = $1);

-- name: GetCrew :one
-- Everything but the image bytes (#1237): GetCrewImage serves those.
select id, name, icon, owner_id, created_at, code, (image_set_at is not null)::boolean as has_image, (renamed_at is not null)::boolean as named, board_enabled, listed, ics_token from crews where id = $1;

-- name: SetCrewRole :exec
-- Admin, member or banned. The owner is crews.owner_id and cannot be expressed here,
-- which is what makes them un-removable (ADR-0038, second amendment).
insert into crew_roles (crew_id, user_id, role) values ($1, $2, $3)
on conflict (crew_id, user_id) do update set role = excluded.role, set_at = now();

-- name: SetCrewBoard :exec
-- The weekly board's switch (ADR-0036 as amended by ADR-0058): off until the
-- crew's owner or an admin turns it on, and the door says which it is.
update crews set board_enabled = $2 where id = $1;

-- name: SetCrewListed :exec
-- In the public directory (ADR-0039 as amended by ADR-0058, #2445): off until
-- the crew's owner or an admin lists it.
update crews set listed = $2 where id = $1;

-- name: GetCrewPrefs :one
-- The caller's own switches on their crew membership (#2432). No row is an
-- owner who never set one: the global opt-in still decides their mail, and
-- nobody is on a board they never said yes to — the narrow side.
select coalesce(bool_or(notify), true)::boolean as notify,
       coalesce(bool_or(on_board), false)::boolean as on_board
from crew_roles where crew_id = $1 and user_id = $2 and role <> 'banned';

-- name: SetCrewPrefs :one
-- Keyed on (crew, caller), so setting someone else's switches is not a shape
-- this can take. The insert is the owner's first answer — owner beats the row
-- in CrewRoleOf, so a member row on them changes nothing but these two
-- switches — and a ban is never overwritten.
insert into crew_roles (crew_id, user_id, role, notify, on_board) values ($1, $2, 'member', $3, $4)
on conflict (crew_id, user_id) do update set notify = excluded.notify, on_board = excluded.on_board
where crew_roles.role <> 'banned'
returning notify, on_board;

-- name: LeaveCrewChannels :exec
-- The named admissions to the crew's private channels go with the membership,
-- as a room grant did (#1672): left behind, lifting a ban or rejoining by the
-- code handed back channels nobody had named them into again.
delete from channel_members cm using channels c
where c.id = cm.channel_id and c.crew_id = $1 and cm.user_id = $2;

-- name: SettleNewOwnerRow :exec
-- The new owner's row stays, as a plain member (#2432): it carries their
-- notify and on_board, and deleting it put a rider who had left the board back
-- on it at the default. Owner beats the row everywhere it is read, and a
-- banned or admin word on it would only mislead the next reader.
update crew_roles set role = 'member', set_at = now() where crew_id = $1 and user_id = $2;

-- name: TransferCrew :exec
-- Ownership transfers, deliberately and on account deletion (ADR-0038, second
-- amendment). crews.owner_id is ON DELETE RESTRICT, so the purge path MUST run
-- this before deleting a user or the deletion fails loudly — which is the
-- intended behaviour, not a bug to work around.
--
-- Always through makeOwner in Go, never alone: the new owner's crew_roles row
-- has to go with it (#1212). Owner beats every role in CrewRoleOf, but a
-- query that reads crew_roles alone does not ask who owns the crew, so a
-- banned row left on an owner reads as a ban there.
update crews set owner_id = $2 where id = $1;

-- name: UpdateCrew :one
-- A changed name is a person naming the crew; an icon pick with the same name
-- is not (audit 2026-09-09).
update crews set name = $2, icon = $3,
       renamed_at = case when name <> $2 then now() else renamed_at end
where id = $1
returning id, name, icon, owner_id, created_at, code, image_mime, image, image_set_at,
       renamed_at, founded_by, board_enabled, listed, ics_token;

-- name: SetCrewCode :exec
-- A new invite (#1930): the old code, and every link carrying it, stops
-- working the moment this commits. The unique index is the collision check.
update crews set code = $2 where id = $1;

-- name: SetCrewImage :exec
update crews set image_mime = $2, image = $3, image_set_at = now() where id = $1;

-- name: ClearCrewImage :exec
update crews set image_mime = null, image = null, image_set_at = null where id = $1;

-- name: GetCrewImage :one
-- The blob alone: GetCrew selects * and every crew read would otherwise carry
-- up to 2 MB it never shows.
select image_mime, image, image_set_at from crews where id = $1 and image is not null;

-- name: ListCrewsOwnedBy :many
select id, name, icon, owner_id, created_at, code, image_mime, image, image_set_at,
       renamed_at, founded_by, board_enabled, listed, ics_token
from crews where owner_id = $1 order by created_at;

-- name: DeleteCrew :exec
delete from crews where id = $1;

-- name: LockCrew :exec
-- The crew's write lock, held for the length of a transaction (#2079): what
-- serialises two plans racing for the crew's last slot under the planned
-- session ceiling. Lock order in this app is USERS BEFORE CREWS.
select 1 from crews where id = $1 for update;

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
-- The crew's people (#1236: the owner plus every member and admin row).
--
-- Person-visibility follows the channels the VIEWER may enter (#1135, as
-- ADR-0058 and #2465 re-keyed it from rooms): a plain member sees the
-- crew-mates they share an enterable channel with (and themselves); the
-- owner and admins act on people by id, so for them `everyone` is true and
-- the list is the whole crew.
--
-- The crew's OWNER is named to everyone in it, whatever channels they share
-- (#1255): an owner is whose crew it is, and every hand-over and the Leave
-- that says "hand it to someone first" is about them. A roster that cannot
-- name them reads as broken.
with people as (
    select c.owner_id as user_id, c.created_at as since from crews c where c.id = sqlc.arg(crew_id)
    union all
    select cr.user_id, coalesce(cr.joined_at, cr.set_at) from crew_roles cr
    where cr.crew_id = sqlc.arg(crew_id) and cr.role in ('member', 'admin')
      -- A stray member row for the owner (a listed-room join wrote one, #1671)
      -- must not list them twice: the page keys its list by id.
      and cr.user_id <> (select o.owner_id from crews o where o.id = sqlc.arg(crew_id))
)
select u.id, u.display_name, u.avatar_url, p.since::timestamptz as since,
    -- The status goes where the name goes (ADR-0060).
    u.status_emoji, u.status_emoji_id, u.status_text, u.status_expires_at
from people p
join users u on u.id = p.user_id
where sqlc.arg(everyone)::boolean
   or u.id = sqlc.arg(viewer)
   or u.id = (select o.owner_id from crews o where o.id = sqlc.arg(crew_id))
   or exists (select 1 from channels c
              join visible_channels mine on mine.channel_id = c.id and mine.user_id = sqlc.arg(viewer)
              join visible_channels theirs on theirs.channel_id = c.id and theirs.user_id = u.id
              where c.crew_id = sqlc.arg(crew_id))
order by since
limit 1000; -- an engineering bound (#1416): a crew is a training circle, not a forum

-- name: ListCrewBanned :many
select u.id, u.display_name, u.avatar_url, cr.set_at
from crew_roles cr
join users u on u.id = cr.user_id
where cr.crew_id = $1 and cr.role = 'banned'
order by cr.set_at;

-- name: ListCrewsFor :many
-- Every crew you are in (#1476), for the sidebar.
select c.id, c.name, c.icon,
       (c.image_set_at is not null)::boolean as has_image,
       coalesce(c.code, '')::text as code,
       (c.renamed_at is not null)::boolean as named,
       (c.owner_id = sqlc.arg(user_id))::boolean as owned,
       (c.founded_by = sqlc.arg(user_id))::boolean as founded,
       exists (select 1 from crew_roles cr
               where cr.crew_id = c.id and cr.user_id = sqlc.arg(user_id) and cr.role = 'admin')::boolean as admin
from crews c
where c.owner_id = sqlc.arg(user_id)
   or exists (select 1 from crew_roles cr
              where cr.crew_id = c.id and cr.user_id = sqlc.arg(user_id) and cr.role in ('member', 'admin'))
order by c.created_at
limit 100; -- an engineering bound (#1416): a rider is in a handful of crews

-- name: PickCrewSuccessor :one
-- docs/SPEC.md's succession rule: the longest-standing admin, else the
-- longest-standing member (#1236: the rows, not the rooms); never the
-- departing owner, never anyone the crew banned. No row means nobody is left
-- and the crew is deleted rather than left ownerless.
select cr.user_id
from crew_roles cr
where cr.crew_id = sqlc.arg(crew_id) and cr.user_id <> sqlc.arg(departing) and cr.role in ('admin', 'member')
order by (cr.role = 'admin') desc, coalesce(cr.joined_at, cr.set_at)
limit 1;

-- name: ListListedCrews :many
-- The opt-in public directory (ADR-0039 as amended by ADR-0058, #2445): every
-- crew whose admins chose to be findable, and NOTHING ELSE ABOUT THEM — a
-- name, a mark and a link. The link is the code, because the door is the only
-- way in and a listing opens it (#2245); the image is the mark the door
-- already shows whoever holds that code. No member count, no activity, no
-- owner: ListListedRooms' reasoning, word for word, and adding a column here
-- is still a decision.
select name, icon, code, (image_set_at is not null)::boolean as has_image
from crews
where listed and code is not null
order by name asc, code asc
limit sqlc.arg(lim) offset sqlc.arg(off);

-- name: GetCrewCardByCode :one
-- What a shared /c/{code} link unfurls to (#2445): the door's own answer —
-- name and picture — for whoever holds the code, crawler included.
select name, image from crews where code = $1;
