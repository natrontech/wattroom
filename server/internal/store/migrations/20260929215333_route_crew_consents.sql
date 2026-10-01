-- +goose Up
-- The owner's answer, once per route per crew (#3096, ADR-0063 "A listed crew
-- asks first"): may a crew listed in the public directory see this route's
-- map? Anyone can walk into such a crew, so the owner pays a privacy cost the
-- click does not show. Unasked, and declined, keep the map from the crew; the
-- session still rides the road, keyed by the route's secret.
--
-- Add-only (ADR-0019): a new table the release before this one never reads.
-- It goes with the route and with the crew.
create table route_crew_consents (
    route_id   uuid        not null references routes (id) on delete cascade,
    crew_id    uuid        not null references crews (id) on delete cascade,
    shared     boolean     not null,
    decided_at timestamptz not null default now(),
    primary key (route_id, crew_id)
);

-- The crew's own foreign key, so a crew's delete does not scan every answer.
create index route_crew_consents_crew on route_crew_consents (crew_id);

-- +goose Down
drop table if exists route_crew_consents;
