-- +goose Up

-- One row per (provider, external id). A user may link several providers; the
-- first sign-in creates the user, later ones attach. No password path exists by
-- design (WATTROOM.md) — this table IS the entire credential story.
create table identities (
    provider         text not null check (provider in ('google', 'github', 'strava')),
    provider_user_id text not null,
    user_id          uuid not null references users (id) on delete cascade,
    -- OAuth tokens are stored ONLY for Strava, whose grant doubles as the M6
    -- ride-upload integration. Google/GitHub identify the user and their tokens
    -- are dropped on purpose — do not store what nothing will ever read.
    access_token     text,
    refresh_token    text,
    token_expires_at timestamptz,
    created_at       timestamptz not null default now(),
    primary key (provider, provider_user_id)
);

create index identities_user on identities (user_id);

-- Server-side sessions: revocable, no JWT machinery. The cookie carries a
-- random token; only its SHA-256 lands here, so a database leak does not mint
-- valid cookies.
create table sessions (
    token_hash bytea primary key,
    user_id    uuid not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create index sessions_expiry on sessions (expires_at);

-- +goose Down
drop table sessions;
drop table identities;
