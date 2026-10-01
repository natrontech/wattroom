-- +goose Up
-- The looks riders have worn, by content (#3155): a voice channel's roster
-- names an outfit by its hash and every client fetches it once, so one hash
-- names one loadout for ever — a changed outfit is a new row, never an edit.
-- outfits.look_hash is the one a rider wears now. Text, not jsonb: the
-- canonical bytes are kept as hashed, so a look's body hashes to its name.
--
-- Add-only (ADR-0019): a new table and a nullable column the release before
-- this one never reads.
create table looks (
    hash       text primary key,
    loadout    text not null,
    created_at timestamptz not null default now()
);
alter table outfits add column look_hash text;

-- +goose Down
alter table outfits drop column if exists look_hash;
drop table if exists looks;
