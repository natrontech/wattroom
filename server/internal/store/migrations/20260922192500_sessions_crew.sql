-- +goose Up
-- Sessions belong to the crew and run in a voice channel (ADR-0058, #2431):
-- the plans on its calendar, the recaps sessions leave, the medals they award
-- and the rides ridden in them all gain the crew, and the voice channel where
-- there is one. RSVPs hang off a plan's id and move with it untouched.
--
-- A session has no table: its id is minted by the hub when it starts and
-- written onto what it leaves (ADR-0058). Recaps and rides from before this
-- migration never had one and are not given an invented one; `session_id`
-- stays null on them.
--
-- Expand only (ADR-0019). `room_id` stays on every table and stays written by
-- the release before this one until #2433. Where it is NOT NULL it is relaxed
-- behind a room-or-crew check: a plan, a recap or a medal made in a crew after
-- this migration has no room, and would otherwise be unwritable. The previous
-- release always sets `room_id`, so nothing it writes can fail.

alter table scheduled_sessions
    -- Cascade: a crew's calendar goes with the crew, as a room's did.
    add column crew_id uuid references crews (id) on delete cascade,
    -- The voice channel it will run in, or none yet (#2440). Deleting the
    -- channel leaves the plan unassigned rather than deleting a plan members
    -- have answered.
    add column channel_id uuid references channels (id) on delete set null,
    alter column room_id drop not null,
    add constraint scheduled_sessions_room_or_crew check (room_id is not null or crew_id is not null);

create index scheduled_sessions_crew_time on scheduled_sessions (crew_id, starts_at);

alter table session_recaps
    add column crew_id uuid references crews (id) on delete cascade,
    -- Cascade, not set null: who may read a recap is who may enter the channel
    -- it ran in (docs/SPEC.md, ADR-0058), and a recap whose private channel
    -- was deleted must not fall open to the whole crew. Deleting a room took
    -- its recaps; deleting a channel does too.
    add column channel_id uuid references channels (id) on delete cascade,
    add column session_id uuid,
    alter column room_id drop not null,
    add constraint session_recaps_room_or_crew check (room_id is not null or crew_id is not null);

-- One recap per session, stated on the id a session now has. The room-era
-- rule — one per (room, started_at) — stays for the rows that have a room.
create unique index session_recaps_one_per_session_id on session_recaps (session_id)
    where session_id is not null;
-- The crew's recaps newest first, and the 90-day prune (docs/SPEC.md).
create index session_recaps_crew_ended on session_recaps (crew_id, ended_at desc);

alter table medals
    add column crew_id uuid references crews (id) on delete cascade,
    alter column room_id drop not null,
    add constraint medals_room_or_crew check (room_id is not null or crew_id is not null);

create index medals_crew on medals (crew_id, awarded_at desc);

alter table rides
    -- Set null, as `room_id` is: a ride is the rider's, and outlives the crew
    -- it was ridden with (WATTROOM.md — nobody ever loses a ride).
    add column crew_id uuid references crews (id) on delete set null,
    -- Beyond the plan's two columns, and for the same reason: a ride's page
    -- names the channel it was ridden in (#2443, #2457), and for every ride
    -- from before this migration `room_channels` is the only place that
    -- still knows it.
    add column channel_id uuid references channels (id) on delete set null,
    add column session_id uuid;

create index rides_crew_started on rides (crew_id, started_at desc) where crew_id is not null;

-- Backfill: the room's crew, and its voice channel — a session ran in the
-- room's call, which is what the voice channel is. Each statement only
-- touches rows not yet moved, so a later migration can repeat it for anything
-- a rolled-back release wrote.
update scheduled_sessions s
set crew_id = r.crew_id, channel_id = rc.voice_channel_id
from rooms r
left join room_channels rc on rc.room_id = r.id
where s.room_id = r.id and s.crew_id is null;

update session_recaps s
set crew_id = r.crew_id, channel_id = rc.voice_channel_id
from rooms r
left join room_channels rc on rc.room_id = r.id
where s.room_id = r.id and s.crew_id is null;

update medals m
set crew_id = r.crew_id
from rooms r
where m.room_id = r.id and m.crew_id is null;

update rides d
set crew_id = r.crew_id, channel_id = rc.voice_channel_id
from rooms r
left join room_channels rc on rc.room_id = r.id
where d.room_id = r.id and d.crew_id is null;

-- +goose Down
-- The relaxed NOT NULLs are not put back: rows written in a crew after the Up
-- have no room, and forcing one would fail the Down on them.
drop index rides_crew_started;
alter table rides drop column session_id, drop column channel_id, drop column crew_id;
drop index medals_crew;
alter table medals drop constraint medals_room_or_crew, drop column crew_id;
drop index session_recaps_crew_ended;
drop index session_recaps_one_per_session_id;
alter table session_recaps
    drop constraint session_recaps_room_or_crew,
    drop column session_id,
    drop column channel_id,
    drop column crew_id;
drop index scheduled_sessions_crew_time;
alter table scheduled_sessions
    drop constraint scheduled_sessions_room_or_crew,
    drop column channel_id,
    drop column crew_id;
