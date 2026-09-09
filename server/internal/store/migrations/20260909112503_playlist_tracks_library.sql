-- +goose Up

-- A saved playlist is a saved queue (ADR-0045, #1426, settles #655): an entry
-- is exactly what a JukeboxEntry is — a video, a pasted YouTube playlist, or
-- a library track. The library entry points at tracks.id with a real foreign
-- key: a deleted MP3 leaves every playlist, which is the behaviour wanted,
-- while a YouTube video cannot be deleted by us and stays a plain id.
--
-- Expand-only (ADR-0019): one nullable column, one partial index, and a
-- check every existing row already satisfies (they all carry a video_id).
-- The release before this never writes track_id and reads the rest unchanged.
alter table playlist_tracks add column track_id uuid references tracks (id) on delete cascade;
alter table playlist_tracks alter column video_id set default '';
alter table playlist_tracks add constraint playlist_tracks_one_source
    check ((video_id <> '') <> (track_id is not null));
create index playlist_tracks_track on playlist_tracks (track_id) where track_id is not null;

-- +goose Down
drop index if exists playlist_tracks_track;
alter table playlist_tracks drop constraint if exists playlist_tracks_one_source;
alter table playlist_tracks alter column video_id drop default;
alter table playlist_tracks drop column if exists track_id;
