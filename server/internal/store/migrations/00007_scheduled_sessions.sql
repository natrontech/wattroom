-- +goose Up
-- Planned rides (#116): a coach schedules a workout at a time; the room and
-- the rooms list show where the action will be. Deleting the room takes its
-- plans with it; nothing here references rides — a plan is not a ride.
create table scheduled_sessions (
    id           uuid primary key default gen_random_uuid(),
    room_id      uuid not null references rooms (id) on delete cascade,
    workout_name text not null,
    -- The docs/SPEC.md workout JSON, stored as written like workouts.definition.
    workout_json jsonb not null,
    starts_at    timestamptz not null,
    created_by   uuid not null references users (id) on delete cascade,
    created_at   timestamptz not null default now()
);
create index scheduled_sessions_room_time on scheduled_sessions (room_id, starts_at);

-- +goose Down
drop table scheduled_sessions;
