-- +goose Up
-- crew_roles.set_at is bumped by every role change (SetCrewRole's upsert),
-- and it was also the person's "since" on the crew page and the seniority
-- PickCrewSuccessor orders by — promoting a founding member made them the
-- newest (audit 2026-09-09). joined_at is written once, on the first row;
-- set_at stays "when the current role was set", which the ban list reads as
-- "banned on". Nullable with a default (expand, ADR-0019): the release
-- before this never writes it, and readers coalesce to set_at.
alter table crew_roles add column joined_at timestamptz default now();
update crew_roles set joined_at = set_at where joined_at is null;

-- +goose Down
alter table crew_roles drop column joined_at;
