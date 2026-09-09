-- +goose Up

-- "Just played" survives a restart (#1432). The hub kept the last five in
-- memory and lost them with every deploy; track_plays already recorded
-- library plays for smart shuffle. It records YouTube plays too now — a
-- video id and the title the deck showed — and a room the hub creates seeds
-- its history from the newest rows.
--
-- Expand-only (ADR-0019): track_id loses NOT NULL (widening — the release
-- before this always writes it), two defaulted columns, a check every
-- existing row satisfies, one index for the newest-first read. Smart shuffle
-- joins on track_id and never sees a video row.
alter table track_plays alter column track_id drop not null;
alter table track_plays add column video_id text not null default '';
alter table track_plays add column title text not null default '';
alter table track_plays add constraint track_plays_one_source
    check ((track_id is not null) <> (video_id <> ''));
create index if not exists track_plays_room_at on track_plays (room_id, at desc);

-- +goose Down
drop index if exists track_plays_room_at;
alter table track_plays drop constraint if exists track_plays_one_source;
delete from track_plays where track_id is null;
alter table track_plays drop column if exists title;
alter table track_plays drop column if exists video_id;
alter table track_plays alter column track_id set not null;
