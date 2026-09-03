-- +goose Up

-- Playlists (#627): a saved, named, ordered list of jukebox entries — either
-- room-owned (survives past any one queue, editable by any member, one
-- markable active for autoplay) or personal (belongs to a rider, follows
-- them into any room). Exactly one owner. Distinct from a queued-whole
-- YouTube playlist (docs/SPEC.md "Playlist", #615) and from the self-hosted
-- pool's future library playlists (#268) — this holds neither uploads nor a
-- second definition of a track, just the same {video, or whole YouTube
-- playlist} shape the live queue already accepts.
create table playlists (
    id         uuid primary key default gen_random_uuid(),
    room_id    uuid references rooms (id) on delete cascade,
    user_id    uuid references users (id) on delete cascade,
    name       text not null check (char_length(name) between 1 and 80),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((room_id is not null) <> (user_id is not null))
);

create index playlists_room on playlists (room_id) where room_id is not null;
create index playlists_user on playlists (user_id) where user_id is not null;

-- One row per entry, in list order. Mirrors what the live queue's "add"
-- already accepts (server/internal/hub/jukebox_entry.go): a single video, or
-- a whole YouTube playlist queued as one entry (yt_playlist_id set, tracks
-- holding the resolved {videoId,title} list) — so "queue this playlist" is a
-- straight replay of the same adds a paste would have produced.
create table playlist_tracks (
    id                uuid primary key default gen_random_uuid(),
    playlist_id       uuid not null references playlists (id) on delete cascade,
    position          integer not null,
    video_id          text not null,
    title             text not null default '',
    start_sec         real not null default 0,
    yt_playlist_id    text not null default '',
    yt_playlist_title text not null default '',
    tracks            jsonb not null default '[]',
    unique (playlist_id, position)
);

create index playlist_tracks_playlist on playlist_tracks (playlist_id, position);

-- Autoplay (#627): starts the room's active playlist when a rider joins an
-- idle deck. Expand-only onto rooms (ADR-0019) — every column
-- nullable/defaulted so a rolled-back release reads them harmlessly.
alter table rooms add column autoplay_enabled boolean not null default false;
alter table rooms add column autoplay_order text not null default 'ordered'
    check (autoplay_order in ('ordered', 'shuffled'));
alter table rooms add column autoplay_playlist_id uuid references playlists (id) on delete set null;
alter table rooms add column autoplay_fixed_video_id text not null default '';
alter table rooms add column autoplay_fixed_video_title text not null default '';

-- +goose Down
alter table rooms drop column autoplay_fixed_video_title;
alter table rooms drop column autoplay_fixed_video_id;
alter table rooms drop column autoplay_playlist_id;
alter table rooms drop column autoplay_order;
alter table rooms drop column autoplay_enabled;
drop table playlist_tracks;
drop table playlists;
