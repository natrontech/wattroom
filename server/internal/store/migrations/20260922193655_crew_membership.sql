-- +goose Up
-- Crew membership takes over what room membership carried (ADR-0058, #2432):
-- a rider's switches — planned-session mail and the weekly board — move from
-- each `memberships` row onto their one `crew_roles` row, and the switches a
-- room carried move onto the crew. `crew_roles` has stored membership since
-- #1236 (member, admin or banned, with joined_at); this finishes the job.
--
-- Expand only (ADR-0019): new columns with defaults, and rows added to a table
-- the previous release already reads. Every value that previous release could
-- read is one it already knew how to read — a member row, an admin row, a
-- banned row, including the stray member row for a crew's owner that it has
-- skipped since #1671.
--
-- One rule governs the backfill, ADR-0058's: nobody can reach, see or be shown
-- anything after this migration that they could not before. The three places
-- it bites are marked below.

alter table crew_roles
    -- Narrows `users.notify_planned`, never overrides it: the global switch is
    -- the opt-in (ADR-0030), this is "not for this crew".
    add column notify boolean not null default true,
    -- The weekly board's "include me" (ADR-0036). True for a rider who joins
    -- through the door, which says the board exists before they walk in.
    add column on_board boolean not null default true;

alter table crews
    -- Off until the crew turns it on (ADR-0036, amended by ADR-0058).
    add column board_enabled boolean not null default false,
    -- The reaction palette, the room's `cheers` convention: '' is the base set.
    add column cheers text not null default '',
    -- In the public directory (ADR-0039, amended by ADR-0058).
    add column listed boolean not null default false,
    -- The crew's calendar feed (ADR-0021, amended by ADR-0058). The volatile
    -- default stamps every existing crew with its own fresh token: a room's
    -- token is not reused, because the room feed and its subscribers end here.
    add column ics_token text not null default replace(gen_random_uuid()::text, '-', '');

-- 1. Everyone in a room of the crew is in the crew. Most already are (#1236
--    wrote the row at the door); this adds whoever is not — the crew's owner
--    included, whose switches need a row to live on. Room owners and coaches
--    come in as members: promoting them would open every private channel of
--    the crew to them.
insert into crew_roles (crew_id, user_id, role, joined_at)
select r.crew_id, m.user_id, 'member', min(m.joined_at)
from memberships m
join rooms r on r.id = m.room_id
where m.role <> 'banned' and r.crew_id is not null
group by r.crew_id, m.user_id
on conflict (crew_id, user_id) do nothing;

-- 2. A room ban becomes a crew ban. There is one ban now, and dropping a room's
--    would let the rider into the channels of the room that banned them. A
--    rider banned from one room and welcome in another loses the other too,
--    until an admin lifts it — the narrow side. The crew's owner is the one
--    exception, because the owner cannot be banned at all.
insert into crew_roles (crew_id, user_id, role)
select distinct r.crew_id, m.user_id, 'banned'
from memberships m
join rooms r on r.id = m.room_id
join crews c on c.id = r.crew_id
where m.role = 'banned' and m.user_id <> c.owner_id
on conflict (crew_id, user_id) do update set role = 'banned', set_at = now();

-- 3. The switches, for every member and admin: `notify` is on unless the rider
--    had turned it off in every room of the crew they were in, and stays on for
--    a rider who was in none (they never said no, and the global opt-in still
--    decides). `on_board` is on ONLY for a rider who was already on a board —
--    their switch on, in a room whose board was on. A crew board lit because
--    one of its rooms had one would otherwise put everyone from the crew's
--    other rooms on it without the door ever having asked them: ADR-0036's
--    enrolment by existence, which ADR-0038 kept the board room-scoped to
--    prevent.
update crew_roles cr
set notify = coalesce(s.notify, true),
    on_board = coalesce(s.on_board, false)
from (
    select c.crew_id, c.user_id,
           bool_or(m.notify) as notify,
           bool_or(m.on_board and r.board_enabled) as on_board
    from crew_roles c
    left join rooms r on r.crew_id = c.crew_id
    left join memberships m on m.room_id = r.id and m.user_id = c.user_id and m.role <> 'banned'
    where c.role in ('member', 'admin')
    group by c.crew_id, c.user_id
) s
where cr.crew_id = s.crew_id and cr.user_id = s.user_id;

-- 4. The crew takes its rooms' switches: a board if any room kept one (the
--    rule above decides who is on it), listed if any room was (a listed room
--    was already a public door into the crew, #2245), and the reaction set of
--    its oldest room that chose one.
update crews c
set board_enabled = s.board_enabled,
    listed = s.listed,
    cheers = coalesce(s.cheers, '')
from (
    select r.crew_id,
           bool_or(r.board_enabled) as board_enabled,
           bool_or(r.listed) as listed,
           (array_agg(r.cheers order by r.created_at, r.id) filter (where r.cheers <> ''))[1] as cheers
    from rooms r
    where r.crew_id is not null
    group by r.crew_id
) s
where c.id = s.crew_id;

-- +goose Down
-- The member and banned rows the backfill wrote stay: the previous release
-- reads them as it reads any other, and removing them would readmit the riders
-- step 2 banned.
alter table crews
    drop column ics_token,
    drop column listed,
    drop column cheers,
    drop column board_enabled;
alter table crew_roles
    drop column on_board,
    drop column notify;
