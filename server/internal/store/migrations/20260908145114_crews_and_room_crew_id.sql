-- +goose Up
-- The crew: the layer above rooms (ADR-0038, #1106). A crew carries name,
-- icon, membership, its rooms and a crew-wide chat; it carries no voice, no
-- deck, no session, no game and no metrics. Nothing a room owns moves.
--
-- NOTHING READS ANY OF THIS YET. This migration and its view are the
-- foundation; the gates and visibility joins are repointed in a later PR of
-- the same release. ADR-0038's third amendment is explicit that the single
-- permission expression is built BEFORE any gate moves, because the failure
-- mode of a forgotten guard is silent over-permission (#1109, #1114 — four
-- joins that each omitted `role != 'banned'` at one level).

create table crews (
    id   uuid primary key default gen_random_uuid(),
    name text not null,
    -- Same convention as rooms.icon: '' is "no icon", the default lives in
    -- code, and the stored value is a lucide key (ADR-0013 as amended by #447).
    icon text not null default '',
    -- ON DELETE RESTRICT, deliberately, and this is the one line in the file
    -- worth arguing about. `rooms.owner_id` cascades, which is right for a
    -- room: it is one person's, and WATTROOM.md's delete-account purge is
    -- worth more than the room. A crew holds rooms OTHER PEOPLE own and a room
    -- is bound to its crew permanently, so a cascade here would let one
    -- account deletion destroy rooms its owner never touched.
    --
    -- Restrict makes forgetting loud: the purge fails rather than silently
    -- leaving an ownerless crew, which is the lockout gap ADR-0038's second
    -- amendment closed. The purge path's job is to TRANSFER ownership before
    -- deleting the user — see the amendment; that lands with the gates.
    owner_id   uuid not null references users (id) on delete restrict,
    created_at timestamptz not null default now()
);

-- Only what cannot be derived. Crew membership FOLLOWS room membership
-- (ADR-0038): you are in a crew because you hold a live membership in one of
-- its rooms, so plain membership is deliberately NOT stored here — a stored
-- copy would be a second answer to a question `memberships` already answers,
-- and the two would drift.
--
-- What is left is the two facts room membership cannot imply: an admin grant,
-- and a crew ban. The ban needs a row of its own precisely because it must
-- survive having no room membership at all — that is what stops a rejoin.
create table crew_roles (
    crew_id uuid not null references crews (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    -- No 'owner' here: the owner is crews.owner_id, exactly one per crew and
    -- un-removable, so it cannot be expressed as a row somebody could delete.
    -- No 'member' either: that is the derived case above.
    role    text not null check (role in ('admin', 'banned')),
    set_at  timestamptz not null default now(),
    primary key (crew_id, user_id)
);

create index crew_roles_user on crew_roles (user_id);

-- NULLABLE, and it stays nullable this release. ADR-0038 says to constrain it
-- NOT NULL in the same release; that is wrong and ADR-0019 outranks it. The
-- previous release's CreateRoom inserts (code, slug, name, owner_id) and knows
-- nothing about this column, so a NOT NULL without a default would leave a
-- rolled-back image unable to create any room at all — and expand/contract is
-- "the only reason retagging to PREVIOUS is safe". Crewless rooms are
-- forbidden in code from this release; the constraint is the contract half and
-- belongs one release later, exactly like identities.refresh_token (#1038).
alter table rooms add column crew_id uuid references crews (id) on delete restrict;

create index rooms_crew on rooms (crew_id);

-- +goose StatementBegin
-- Backfill: ONE CREW PER OWNER, not one per room. An owner with three rooms
-- gets one crew of three — that is what makes permanent room-crew binding
-- survivable, because people arrive already grouped rather than holding N
-- one-room crews they can never merge.
do $$
declare
    r record;
    new_crew uuid;
begin
    for r in select distinct owner_id from rooms where crew_id is null loop
        insert into crews (name, owner_id)
        select coalesce(nullif(u.display_name, ''), 'My crew'), r.owner_id
        from users u where u.id = r.owner_id
        returning id into new_crew;

        update rooms set crew_id = new_crew
        where owner_id = r.owner_id and crew_id is null;
    end loop;
end $$;
-- +goose StatementEnd

-- Crew-visible or private. FALSE is the default on purpose and is doing real
-- work: ADR-0038's first amendment scopes the crew-visible default to rooms
-- created AFTER the cutover, because flipping every existing room to
-- crew-visible on upgrade would expose rooms to their owner's other rooms
-- without anyone being asked. RESEARCH.md 16.3 has the precedent — the FTC's
-- Google Buzz order requires consent before a product change shares data
-- contrary to the promise made when it was collected, and `rooms.listed`'s own
-- schema comment is that promise.
--
-- It also fails safe twice over: a rolled-back release's CreateRoom cannot set
-- it, and a forgotten INSERT in the new code gets the private value rather
-- than the leaking one.
alter table rooms add column crew_visible boolean not null default false;

-- The "named exceptions" half of ADR-0038's private rooms: someone let into a
-- room they are not a member of and whose crew cannot see it.
--
-- Existing members need no row here. A member is admitted by their membership,
-- which is why migrating every existing room to private costs no backfill —
-- everyone who could see a room yesterday still holds the membership that
-- shows it to them.
create table room_grants (
    room_id    uuid not null references rooms (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    granted_at timestamptz not null default now(),
    primary key (room_id, user_id)
);

create index room_grants_user on room_grants (user_id);

-- THE single permission expression (ADR-0038, third amendment; RESEARCH.md
-- 16.2). Every gate and every visibility join goes through this and nothing
-- re-derives it, because the four bugs in #1109 and #1114 were not caused by
-- having two kinds of ban — they were caused by the guard being written out by
-- hand in each query, where any one of them could omit it and nothing failed.
-- A join that forgets THIS selects from a relation that is not there, which is
-- an error at generation time instead of a silent widening.
--
-- Deliberately a view and not a materialized one: a handful of crews, tens of
-- rooms and tens of people. Correctness and one place to read it are the whole
-- point; if it ever measures slow, materializing is the upgrade path.
create view visible_rooms as
with crew_membership as (
    -- Crew membership follows room membership (ADR-0038) and is derived rather
    -- than stored: a stored copy would be a second answer to a question
    -- `memberships` already answers, and the two would drift.
    select distinct r.crew_id, m.user_id
    from memberships m
    join rooms r on r.id = m.room_id
    where m.role <> 'banned' and r.crew_id is not null
),
candidates as (
    -- 1. A live membership in the room itself.
    select m.room_id, m.user_id from memberships m where m.role <> 'banned'
    union
    -- 2. A room open to its crew, and you are in that crew.
    select r.id, cm.user_id
    from rooms r
    join crew_membership cm on cm.crew_id = r.crew_id
    where r.crew_visible
    union
    -- 3. A named exception into a room you are not otherwise in.
    select g.room_id, g.user_id from room_grants g
)
select c.room_id, c.user_id
from candidates c
join rooms r on r.id = c.room_id
-- A room ban excludes whatever else would have granted it. Both exclusions are
-- applied AFTER the union on purpose: a ban must beat a grant, and writing it
-- as a filter on each branch is how one branch comes to disagree.
where not exists (
    select 1 from memberships b
    where b.room_id = c.room_id and b.user_id = c.user_id and b.role = 'banned'
)
-- A crew ban excludes from every room in the crew, including rooms a
-- membership or a grant would otherwise allow. This is the level the room ban
-- cannot express, and why ADR-0038's third amendment keeps both.
and not exists (
    select 1 from crew_roles cr
    where cr.crew_id = r.crew_id and cr.user_id = c.user_id and cr.role = 'banned'
);

-- +goose Down
drop view visible_rooms;
drop table room_grants;
alter table rooms drop column crew_visible;
alter table rooms drop column crew_id;
drop table crew_roles;
drop table crews;
