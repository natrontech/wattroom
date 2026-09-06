-- +goose Up
-- Where a ride went, and whether it got there (#799). A new table, so the
-- release that adds it rolls back by image tag alone (ADR-0019).
--
-- Delivery used to live entirely in a goroutine with a 90-second budget: a
-- restart or a Strava outage abandoned it after the ride itself was saved,
-- and nothing on the rider's screen or in the database remembered. One row
-- per ride per destination, so a retry can never open a second delivery for
-- the same pair.
create table ride_exports (
    ride_id     uuid not null references rides (id) on delete cascade,
    destination text not null,
    -- pending: nobody has succeeded yet. delivered: the remote has it, and
    -- remote_id says under what number. failed: the attempts ran out.
    state       text not null default 'pending',
    attempts    int  not null default 0,
    last_error  text,
    remote_id   bigint,
    created_at  timestamptz not null default now(),
    -- When the row last moved. The retry sweep reads it as "not before".
    updated_at  timestamptz not null default now(),
    primary key (ride_id, destination)
);

-- The sweep's only query: rows still owed a try, oldest first.
create index ride_exports_pending on ride_exports (state, updated_at)
    where state = 'pending';

-- +goose Down
drop table ride_exports;
