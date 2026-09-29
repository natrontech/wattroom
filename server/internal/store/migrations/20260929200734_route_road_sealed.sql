-- +goose Up
-- A route's road, sealed (#3511, ADR-0063). `road` held a turn and an
-- absolute height every ~20 m over the whole route, hidden ends included, in
-- the clear — and the turns add back up to the shape `geom_sealed` exists to
-- hide, while the heights pin it on any elevation map. So a dump gave the
-- place away after all.
--
-- - road_sealed: the whole road as the owner posted it, sealed with the
--   shape's key under the same `key_version`; null on a server with no key,
--   which keeps no more than `road` below.
-- - road: from here, only what a dump or a keyless server may hold — heights
--   relative to the first sample, and no turns. It is still a road every
--   reader can ride, so the release before this one reads it as it did.
--
-- Add-only (ADR-0019): one nullable column. Rows stored before it are sealed
-- and stripped at boot (routes.SealRoads).
alter table routes add column road_sealed bytea;

-- +goose Down
alter table routes drop column if exists road_sealed;
