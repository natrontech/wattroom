-- +goose Up
-- A crew's own emoji (#2643): small pictures any member uploads, used as a
-- reaction (key `:name:`) and inline in a line as `:name:`. Blobs in Postgres
-- beside chat_images and board_clips, for their reason: a single VM has no
-- object store (ADR-0002).
--
-- Owned by the CREW, like crew_pins: crew_id cascades, because nothing of a
-- crew's vocabulary outlives the crew. `user_id` cascades too, unlike a pin's
-- SET NULL — the picture is the uploader's upload, the chat_images rule, and
-- a purge takes it (WATTROOM.md). A reaction naming one that is gone draws as
-- its `:name:` text.
--
-- The name's shape is CHECKed as a literal, not read from protocol: a
-- migration is immutable once it has run (limits.go says why). Its bounds are
-- protocol.MinEmojiNameChars and MaxEmojiNameChars.
--
-- Expand/contract (ADR-0019): a release only ADDS — one new table.
create table crew_emoji (
    id         uuid primary key default gen_random_uuid(),
    crew_id    uuid not null references crews (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    name       text not null check (name ~ '^[a-z0-9_]{2,32}$'),
    mime       text not null,
    bytes      bytea not null,
    created_at timestamptz not null default now(),
    -- One :name: per crew. Also the index every read walks: the listing is
    -- "this crew's, by name", and the cap counts the same rows.
    unique (crew_id, name)
);

-- The export's read, and a purge's cascade, are "this rider's".
create index crew_emoji_user on crew_emoji (user_id);

-- +goose Down
drop table crew_emoji;
