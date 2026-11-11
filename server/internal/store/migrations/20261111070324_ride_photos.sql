-- +goose Up
-- The photos a rider takes on a ride (docs/spec/riding.md "The ride's
-- pictures"): the world drawn at a moment they chose, two JPEGs per photo
-- (the World and the Overhead view), kept with the ride so its page offers
-- them after it. Owner-only, like the ride; they go when the ride or the
-- rider goes. Blobs live in Postgres like every other upload (ADR-0002).
--
-- n is the photo's number on its ride, 1..protocol.MaxRidePhotos: the
-- handler holds the cap, and (ride_id, n, view) makes a retried upload land
-- on itself. The CHECK is wider than the cap on purpose, so tuning the cap
-- up is a code change and never a migration.
--
-- Expand only (ADR-0019): a new table the release before this one never
-- reads.
create table ride_photos (
    ride_id    uuid        not null references rides (id) on delete cascade,
    user_id    uuid        not null references users (id) on delete cascade,
    n          smallint    not null check (n between 1 and 20),
    view       text        not null check (view in ('world', 'overhead')),
    bytes      bytea       not null,
    size_bytes integer     not null check (size_bytes > 0),
    created_at timestamptz not null default now(),
    primary key (ride_id, n, view)
);

-- The rider's ceiling is a sum over their rows, asked on every upload.
create index ride_photos_user on ride_photos (user_id);

-- +goose Down
drop table if exists ride_photos;
