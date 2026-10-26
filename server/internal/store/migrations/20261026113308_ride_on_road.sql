-- +goose Up
-- Whether a ride's workout rode a road, placed on it or not (#4154). The
-- Strava title of a road ride is its numbers (ADR-0063); route_key marks only
-- a ride the save could place, and a road ride with no metres, a session
-- rider the bunch never placed, or one whose route was deleted would go out
-- under its generated name, or the client's.
--
-- Add-only (ADR-0019): a nullable column the release before this one never
-- reads. An old ride keeps null, and route_key still marks it.
alter table rides add column on_road boolean;

-- +goose Down
alter table rides drop column if exists on_road;
