-- +goose Up

-- Durable data only (docs/ARCHITECTURE.md): live room state never touches these
-- tables. Everything the hub knows dies with the process; everything here must
-- survive one.

create table users (
    id           uuid primary key default gen_random_uuid(),
    display_name text not null,
    avatar_url   text,
    -- Profile numbers, same bounds the web profile store enforces (50-600 / 30-200).
    ftp_watts    smallint not null default 200 check (ftp_watts between 50 and 600),
    weight_kg    smallint not null default 75 check (weight_kg between 30 and 200),
    created_at   timestamptz not null default now()
    -- OAuth identities land in #16 as their own table; users stays provider-free.
);

create table rooms (
    id         uuid primary key default gen_random_uuid(),
    -- 6-char join code (docs/SPEC.md join flow). Uppercase, no ambiguous chars —
    -- enforced by the generator, unique here.
    code       text not null unique check (char_length(code) = 6),
    -- Share-link slug: wattroom.ch/r/velvet-hammer.
    slug       text not null unique,
    name       text not null,
    owner_id   uuid not null references users (id) on delete cascade,
    -- Rooms are private/unlisted by default; a directory listing is a per-room
    -- owner choice (WATTROOM.md join flow). Privacy is architecture: the default
    -- lives in the schema, not in whoever writes the INSERT.
    listed     boolean not null default false,
    created_at timestamptz not null default now()
);

create table memberships (
    room_id   uuid not null references rooms (id) on delete cascade,
    user_id   uuid not null references users (id) on delete cascade,
    -- Roles matrix in docs/SPEC.md.
    role      text not null default 'member' check (role in ('owner', 'coach', 'member')),
    joined_at timestamptz not null default now(),
    primary key (room_id, user_id)
);

create table workouts (
    id         uuid primary key default gen_random_uuid(),
    -- NULL owner = built-in library workout, visible to everyone.
    owner_id   uuid references users (id) on delete cascade,
    name       text not null,
    author     text not null default '',
    -- The docs/SPEC.md workout JSON, stored as written. The server does not
    -- interpret it beyond validation; the engine that runs it is client-side.
    definition jsonb not null,
    created_at timestamptz not null default now()
);

create table rides (
    id           uuid primary key default gen_random_uuid(),
    -- Cascade is the delete-account purge (ADR-0008): removing a user must take
    -- the sample blobs with it, and the FK makes that structural rather than a
    -- cleanup job someone remembers to write.
    user_id      uuid not null references users (id) on delete cascade,
    -- Solo rides have no room; a room's deletion must not delete rides.
    room_id      uuid references rooms (id) on delete set null,
    workout_name text not null,
    started_at   timestamptz not null,
    -- Summary columns mirror the web history store; queries never need the blob.
    seconds      integer not null check (seconds >= 0),
    avg_watts    smallint not null check (avg_watts between 0 and 3000),
    kj           integer not null check (kj >= 0),
    execution    real not null check (execution between 0 and 1),
    ftp_watts    smallint not null,
    -- Raw 1 Hz samples, gzip-compressed JSON (~50 KB/h — WATTROOM.md §3: plain
    -- Postgres, no extension; samples are only ever read per-ride). Heart rate
    -- lives in here and nowhere shared (ADR-0008).
    samples      bytea not null,
    -- Rides are private by default; sharing is per-ride opt-in. NULL = private.
    shared_at    timestamptz,
    created_at   timestamptz not null default now()
);

create index rides_user_started on rides (user_id, started_at desc);
create index memberships_user on memberships (user_id);

-- +goose Down
drop table rides;
drop table workouts;
drop table memberships;
drop table rooms;
drop table users;
