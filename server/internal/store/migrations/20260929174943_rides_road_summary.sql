-- +goose Up
-- What a ride keeps that exists only at the moment it is saved (#3053):
-- the road it rode, how it was ridden, and the weight that day. None of it
-- can be backfilled, so it lands before the first route ride is saved.
--
-- - route_id: the stored route, set null when its owner deletes it.
-- - route_key: that route's road_hash, which routes.road_hash names its
--   identity — it outlives route_id, and a re-import of the same road finds
--   the rides of the old one (ADR-0068's whole-route ghost).
-- - road_h: the hash of the road the ride was served, which names its data
--   snapshot (#3241). Today the served road is the route's own, so the two
--   agree; they part once a ride is served the map's line.
-- - ride_mode: ADR-0062's five, never the code names. timeable: ADR-0074's
--   rule, written at save.
-- - from_m, distance_m, climbed_m: where on the road the ride started, how
--   far the server's replay of its watts carried it, and what it climbed
--   over the metres ridden.
-- - weight_kg: the rider's weight that day, only when they set it
--   (ADR-0048) — a default is nobody's weight.
-- - mean_shelter: the share of the air the ride was sheltered from
--   (ADR-0077), for the timeable rule once the hub computes shelter.
--
-- Add-only (ADR-0019): nullable columns and indexes the release before this
-- one never reads. An old ride keeps nulls: "not known", never "zero".
alter table rides
    add column route_id     uuid references routes (id) on delete set null,
    add column route_key    text,
    add column road_h       text,
    add column ride_mode    text check (ride_mode in ('free', 'workout', 'bunch', 'race', 'game')),
    add column timeable     boolean,
    add column from_m       integer check (from_m >= 0),
    add column distance_m   integer check (distance_m >= 0),
    add column climbed_m    integer check (climbed_m >= 0),
    add column weight_kg    smallint check (weight_kg between 30 and 200),
    add column mean_shelter real check (mean_shelter between 0 and 1);

-- A rider's earlier rides of the same road, newest first.
create index rides_user_route_key on rides (user_id, route_key, started_at desc)
    where route_key is not null;
-- The foreign key's own, so a route's delete does not scan every ride.
create index rides_route_id on rides (route_id) where route_id is not null;

-- +goose Down
drop index if exists rides_route_id;
drop index if exists rides_user_route_key;
alter table rides
    drop column if exists mean_shelter,
    drop column if exists weight_kg,
    drop column if exists climbed_m,
    drop column if exists distance_m,
    drop column if exists from_m,
    drop column if exists timeable,
    drop column if exists ride_mode,
    drop column if exists road_h,
    drop column if exists route_key,
    drop column if exists route_id;
