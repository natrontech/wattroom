-- +goose Up
-- A rider's own plan (#4615): a workout from their shelf on a day, for them
-- alone. No crew, no mail, no RSVP — the crew schedule (#116) is the plan
-- others see. Home reads today's; an agent lays out a week over MCP.
--
-- `day` is the rider's own calendar date, as their device reads it: a plan
-- is "Thursday", not an instant, so it carries no zone. It goes with the
-- workout it names, and with the rider.
--
-- Expand only (ADR-0019): a new table the release before this one never
-- reads.
create table personal_plans (
    id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        not null references users (id) on delete cascade,
    workout_id uuid        not null references workouts (id) on delete cascade,
    day        date        not null,
    created_at timestamptz not null default now()
);

-- Every read is one rider's days in order.
create index personal_plans_user_day on personal_plans (user_id, day);
-- Deleting a shelf workout cascades here.
create index personal_plans_workout on personal_plans (workout_id);

-- +goose Down
drop table if exists personal_plans;
