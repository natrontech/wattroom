-- +goose Up
-- The jukebox splits along the room's two halves (ADR-0058, #2430): the saved
-- playlists are the CREW's — a crew with two rooms stops keeping two copies
-- of its music — while the deck, and so its autoplay settings and its play
-- log, is the VOICE channel's, one deck per voice channel.
--
-- Expand only (ADR-0019). `room_id` stays on playlists and track_plays, and
-- the autoplay columns stay on rooms, all still read and written by the
-- release before this one until #2433 drops them.

alter table playlists
    -- Cascade, as `room_id` does: a crew's shelf goes with the crew.
    add column crew_id uuid references crews (id) on delete cascade;

-- The owner check is widened, and NOT to "exactly one of crew, user, room",
-- which is what a first reading of the plan says: a room playlist gains its
-- crew below and keeps its `room_id`, because the previous release finds it by
-- that. So the rule is the one the table always meant — a playlist is a
-- rider's or a group's — with a group being a crew, a room, or during this one
-- release a room's playlist carrying both. #2433 tightens it to
-- `crew_id xor user_id` when `room_id` goes.
alter table playlists drop constraint playlists_check;
alter table playlists add constraint playlists_one_owner
    check ((user_id is not null) <> (crew_id is not null or room_id is not null));

create index playlists_crew on playlists (crew_id) where crew_id is not null;

alter table track_plays
    -- Cascade: the log is the channel's taste (docs/SPEC.md, smart autoplay)
    -- and means nothing once the channel is gone.
    add column channel_id uuid references channels (id) on delete cascade,
    -- A play on a voice channel made after this migration has no room behind
    -- it. Relaxing the NOT NULL is an expand — the previous release always
    -- sets it — and the check keeps every row attached to one or the other.
    alter column room_id drop not null,
    add constraint track_plays_room_or_channel check (room_id is not null or channel_id is not null);

-- The two reads the room had, re-keyed: this channel's history of one track,
-- and this channel's recent plays.
create index track_plays_channel_track on track_plays (channel_id, track_id, at desc);
create index track_plays_channel_at on track_plays (channel_id, at desc);

-- Autoplay is a voice channel's (docs/SPEC.md, Autoplay): which crew playlist
-- it plays, in what order, and whether at all. The fixed-start columns rooms
-- still carry were retired by #1422 and are not carried over.
alter table channels
    add column autoplay_enabled boolean not null default false,
    add column autoplay_order text not null default 'ordered'
        check (autoplay_order in ('ordered', 'shuffled', 'smart')),
    add column autoplay_playlist_id uuid references playlists (id) on delete set null;

-- Backfill. Each statement only touches rows not yet moved, so a later
-- migration can repeat it for anything a rolled-back release wrote.
update playlists p
set crew_id = r.crew_id
from rooms r
where p.room_id = r.id and p.crew_id is null;

update track_plays tp
set channel_id = rc.voice_channel_id
from room_channels rc
where rc.room_id = tp.room_id and tp.channel_id is null and rc.voice_channel_id is not null;

update channels c
set autoplay_enabled = r.autoplay_enabled,
    autoplay_order = r.autoplay_order,
    autoplay_playlist_id = r.autoplay_playlist_id
from room_channels rc
join rooms r on r.id = rc.room_id
where c.id = rc.voice_channel_id;

-- +goose Down
-- `track_plays.room_id`'s NOT NULL is not put back: a play on a channel made
-- after the Up has no room, and forcing one would fail the Down on it.
alter table channels
    drop column autoplay_playlist_id,
    drop column autoplay_order,
    drop column autoplay_enabled;
drop index track_plays_channel_at;
drop index track_plays_channel_track;
alter table track_plays
    drop constraint track_plays_room_or_channel,
    drop column channel_id;
drop index playlists_crew;
alter table playlists drop constraint playlists_one_owner;
alter table playlists drop column crew_id;
alter table playlists add constraint playlists_check
    check ((room_id is not null) <> (user_id is not null));
