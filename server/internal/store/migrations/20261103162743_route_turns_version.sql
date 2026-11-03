-- +goose Up
-- Which rule a route's sealed turns were rebuilt under (#4379, #4383). Until
-- 2026-11 each turn was rounded on its own and the heading smoothed over
-- 100 m, so the world drew a long route drifting onto itself and its
-- hairpins wide. Null is a road as its file was imported; the boot rebuilds
-- those turns from the route's own sealed line (routes.StraightenRoads) and
-- writes the rule's number here, so a later rule can rebuild them again.
--
-- Add-only (ADR-0019): one nullable column the release before this one never
-- reads.
alter table routes add column turns_v smallint;

-- +goose Down
alter table routes drop column if exists turns_v;
