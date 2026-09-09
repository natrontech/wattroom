-- +goose Up

-- Contract half of dropping autoplay's fixed start (#1430, ADR-0019). The
-- expand half was 2026.09.68 (#1439): the API, the hub and the web stopped
-- reading and writing these two columns there, and two releases have shipped
-- since — so the image a rollback retags to no longer touches them, and the
-- columns can go. Nothing selects them: sqlc regenerates the rooms model
-- without them in the same change.
alter table rooms drop column if exists autoplay_fixed_video_id;
alter table rooms drop column if exists autoplay_fixed_video_title;

-- +goose Down
alter table rooms add column if not exists autoplay_fixed_video_id text not null default '';
alter table rooms add column if not exists autoplay_fixed_video_title text not null default '';
