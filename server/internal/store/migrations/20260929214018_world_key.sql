-- +goose Up
-- The world key (#3225, ADR-0081): 32 random bytes every world's secrets are
-- derived from — a route's, a private region's, the world's — so no route or
-- zone needs a secret column and nothing needs a backfill. Written here, by
-- the migration itself, so the key exists exactly once and no first use can
-- race another to create it.
--
-- It never rotates by accident: a new key changes every world, cached chunk
-- and photo seed, which is a data-snapshot change named in the release
-- notes. The environment key's re-seal (ADR-0035) and the operator key that
-- HMACs tile and stroke ids rotate without touching it. It describes no
-- rider, so the export does not carry it.
--
-- `one` holds the table to a single row. The bytes are two
-- gen_random_uuid() values, which is what core Postgres has without pgcrypto.
--
-- Add-only (ADR-0019): a new table the release before this one never reads.
create table world_key (
    one boolean primary key default true check (one),
    key bytea   not null check (length(key) = 32)
);

insert into world_key (key)
select decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex')
on conflict do nothing;

-- +goose Down
drop table if exists world_key;
