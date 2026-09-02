-- +goose Up
-- The XP ledger beyond rides (#467). Rides keep their own xp column; every
-- XP earned off the bike is a row here, and a few rows pay nothing but are
-- counted — the ledger is also how achievements measure progress with only
-- what the server can verify. Expand-only (ADR-0019).
create table xp_events (
    id      uuid primary key default gen_random_uuid(),
    user_id uuid not null references users (id) on delete cascade,
    -- lounge: five full minutes in voice (amount 0 past the daily cap).
    -- session: in voice for at least half of a group session.
    -- achievement: the one-time award; ref is the achievement key.
    -- sprint_win / dj_track / coached: amount 0 — counted, never paid.
    source  text not null check (source in (
        'lounge', 'session', 'achievement', 'sprint_win', 'dj_track', 'coached'
    )),
    amount  integer not null check (amount >= 0),
    -- What the row is about (a minute bucket, a session, a track, a key).
    -- With the source it is the idempotency key: a replayed webhook, a
    -- retried save or a second tab cannot pay twice.
    ref     text not null,
    at      timestamptz not null default now(),
    unique (user_id, source, ref)
);

create index xp_events_user_at on xp_events (user_id, at desc);

-- One row per achievement a rider has earned; the catalogue lives in code.
create table achievements (
    user_id   uuid not null references users (id) on delete cascade,
    key       text not null,
    earned_at timestamptz not null default now(),
    primary key (user_id, key)
);

-- Lifetime XP is the rides plus the ledger — one definition for the four
-- places that read it (me, friends, members, DM heads).
-- +goose StatementBegin
create function user_total_xp(uid uuid) returns bigint
language sql stable as $$
    select (select coalesce(sum(xp), 0) from rides where user_id = uid)
         + (select coalesce(sum(amount), 0) from xp_events where user_id = uid);
$$;
-- +goose StatementEnd

-- +goose Down
drop function user_total_xp(uuid);
drop table achievements;
drop table xp_events;
