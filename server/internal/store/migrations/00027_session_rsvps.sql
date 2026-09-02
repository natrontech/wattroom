-- +goose Up
-- Room events (#450): an event is a planned session someone said yes to —
-- there is no second object. One row per rider per session; cancelling an
-- RSVP deletes the row, and cancelling the session takes them all with it.
create table session_rsvps (
    session_id uuid not null references scheduled_sessions (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (session_id, user_id)
);

-- +goose Down
drop table session_rsvps;
