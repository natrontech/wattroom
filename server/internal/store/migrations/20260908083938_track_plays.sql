-- +goose Up
-- What a room did with a pool track (#269, ADR-0015 smart selection step 2:
-- "weighted random in one SQL query — recently-played penalty, skip-count
-- penalty. Requires recording plays and skips per track").
--
-- One row per play or skip, ROOM-SCOPED: a track this room keeps skipping
-- should get quieter here and nowhere else. Privacy is architecture
-- (WATTROOM.md) — one room's taste is not a fact about the pool, and a
-- global counter would leak it into every other room.
--
-- No aggregate columns on `tracks`. A count(*) over a room's own rows is
-- exact by construction; a denormalised counter is a second writer that can
-- disagree with the log it summarises, and nothing here is hot enough to
-- earn one.
--
-- Expand/contract (ADR-0019): a new table only. The release before this runs
-- unchanged, and a rollback simply stops recording — smart shuffle degrades
-- to plain random, which is what an empty history already means.
create table if not exists track_plays (
    id uuid primary key default gen_random_uuid(),
    track_id uuid not null references tracks(id) on delete cascade,
    room_id uuid not null references rooms(id) on delete cascade,
    -- Who queued it, not who pressed skip: "whose track was this" is the
    -- signal a taste model wants (#271), and who did the skipping is already
    -- a room-timeline line. Null when autoplay queued it — nobody did.
    queued_by uuid references users(id) on delete set null,
    -- false: played to its natural end. true: something skipped past it.
    skipped boolean not null,
    at timestamptz not null default now()
);

-- The only read: this room's history for this track, newest first.
create index if not exists track_plays_room_track on track_plays (room_id, track_id, at desc);

-- +goose Down
drop table if exists track_plays;
