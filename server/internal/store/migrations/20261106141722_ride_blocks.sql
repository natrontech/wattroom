-- +goose Up
-- The workout a ride was ridden to, as its blocks (#4430): the ride's picture
-- draws a workout first — its blocks, the watts and the heart rate — and a
-- ride kept its samples, never the workout. `[{"s","n","f","t"}]`, each
-- block's start and length in workout seconds and its target from → to in
-- watts at the ride's FTP (stats.Block). Null on a ride with no workout to
-- draw, and on every ride saved before this: those draw their watts alone.
--
-- Expand only (ADR-0019): a nullable column the release before this one
-- never reads.
alter table rides add column blocks jsonb;

-- +goose Down
alter table rides drop column if exists blocks;
