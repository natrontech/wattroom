-- +goose Up
-- The workout's own name on a ride whose workout_name is its road's. A
-- workout ridden by its clock over a road (a workout on a route) is saved
-- under the route's generated name (#3055), so Against your best, a crew
-- and MCP read the road; the Strava title reads this instead, so a rider who
-- rode Sweet spot over a road sees Sweet spot on Strava, not the road's km.
--
-- Null on every other ride: off a road workout_name already is the
-- workout's, and a road workout or a free ride on a road has no workout name
-- that is not the road's.
--
-- Expand/contract (ADR-0019): one nullable column, no default, no backfill;
-- the release before this one never reads it.
alter table rides add column workout_own_name text;

-- +goose Down
alter table rides drop column if exists workout_own_name;
