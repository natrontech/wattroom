-- +goose Up
-- Which crew was minted FOR a rider (#1928). "Your own crew" — the room a
-- new room lands in, Home's first-run card — resolved to the oldest crew
-- the rider owns, which a hand-over makes somebody else's founding crew.
-- Nullable and backfilled from each owner's oldest crew, so the release
-- before this one reads the table unchanged (ADR-0019).
alter table crews add column founded_by uuid references users (id) on delete set null;
create index crews_founded_by on crews (founded_by);
update crews c set founded_by = c.owner_id
where c.founded_by is null
  and c.id = (select o.id from crews o where o.owner_id = c.owner_id order by o.created_at limit 1);

-- +goose Down
drop index if exists crews_founded_by;
alter table crews drop column founded_by;
