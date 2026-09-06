-- +goose Up
-- `if not exists` throughout, and renumbered past the 00036 collision (#927):
-- a database that applied this file while it was still 00036 already has the
-- table, and re-running it must be a no-op rather than a boot failure. Fresh
-- databases are unaffected.
-- A rider's soundboard clips (#877, ADR-0033). The clip is durable data and
-- the fire is a room event, so only the bytes live here — nothing about a
-- press is ever written. Blobs in Postgres beside chat_images, for the same
-- reason: a single VM has no object store (ADR-0002).
--
-- Scope is where this departs from chat_images: an image belongs to a room and
-- dies with that room's bounded log, a clip belongs to a RIDER and travels
-- into every room they ride in.
create table if not exists board_clips (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users (id) on delete cascade,
    name text not null,
    -- 1-9, or null for a clip that is in the library but on no pad.
    pad smallint,
    duration_ms integer not null,
    bytes bytea not null,
    created_at timestamptz not null default now(),
    constraint board_clips_pad_range check (pad is null or pad between 1 and 9)
);

-- One clip per pad per rider: assigning a pad that is taken replaces it, and
-- the index is what makes that an upsert rather than a read-then-write race.
create unique index board_clips_pad on board_clips (user_id, pad)
where pad is not null;

-- Every read is "this rider's clips": the listing, the quota sum, and the
-- prefetch the room does when they join.
create index if not exists board_clips_owner on board_clips (user_id, created_at desc);

-- +goose Down
drop index board_clips_owner;
drop index board_clips_pad;
drop table board_clips;
