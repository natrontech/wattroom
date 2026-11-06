-- +goose Up
-- The crew's album of rare visitors to its cozy room: which it has seen, and
-- when it first did. Paint, one row per visitor, and nothing about who saw it.
-- Expand only (ADR-0019): a new table the release before this one never reads.
create table crew_sightings (
    crew_id uuid        not null references crews (id) on delete cascade,
    kind    text        not null,
    seen_at timestamptz not null default now(),
    primary key (crew_id, kind)
);

-- +goose Down
drop table if exists crew_sightings;
