-- +goose Up
-- The route a plan rides (#3051): its workout names the route by reference,
-- and this column says so in a form a lookup can use — "is this route in a
-- plan the reader can open" is ADR-0063's crew tier. Set null when the
-- route's owner deletes it; the plan's reference then reads "the route was
-- deleted".
--
-- Add-only (ADR-0019): a nullable column and its index, which the release
-- before this one never reads.
alter table scheduled_sessions
    add column route_id uuid references routes (id) on delete set null;

create index scheduled_sessions_route_id on scheduled_sessions (route_id)
    where route_id is not null;

-- +goose Down
drop index if exists scheduled_sessions_route_id;
alter table scheduled_sessions drop column if exists route_id;
