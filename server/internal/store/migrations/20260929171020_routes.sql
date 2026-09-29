-- +goose Up
-- A rider's stored roads (#3024, ADR-0063): the route keeps its place, sealed.
--
-- `road` is what anyone but the owner may ever be sent — heights and turns
-- every ~20 m, packed as $lib/road's packRoad writes them — and `road_hash`
-- is its identity. The place itself is `geom_sealed`: the owner's shape as
-- polyline6, sealed with WATTROOM_TOKEN_KEY (ADR-0035) under `key_version`,
-- the key's fingerprint, so a rotated key is a re-seal (`wattroom
-- reseal-routes`) rather than a loss. A server with no key stores the road
-- and never the place: both columns null together, never a coordinate in the
-- clear.
--
-- `name` is the owner's own and only ever shown to them; every other surface
-- reads `gen_name`, which the server writes from the road's numbers, so a
-- place cannot travel in it. A route from strava.com (`stravagpx`) rides
-- owner-only.
--
-- Add-only (ADR-0019): a new table the release before this one never reads.
create table routes (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid not null references users (id) on delete cascade,
    src         text not null check (src in ('gpx', 'tcx', 'fit', 'stravagpx')),
    name        text not null check (char_length(name) between 1 and 80),
    gen_name    text not null,
    road        bytea not null,
    road_hash   text not null,
    length_m    integer not null check (length_m > 0),
    gain_m      integer not null check (gain_m >= 0),
    climbs      jsonb not null default '[]',
    ele_source  text not null check (ele_source in ('file', 'none')),
    geom_sealed bytea,
    key_version integer,
    created_at  timestamptz not null default now(),
    check ((geom_sealed is null) = (key_version is null))
);

-- A rider's list, newest first, and the purge's cascade.
create index routes_owner on routes (owner_id, created_at desc);
-- The re-seal walks a key's rows.
create index routes_key_version on routes (key_version) where key_version is not null;

-- +goose Down
drop table if exists routes;
