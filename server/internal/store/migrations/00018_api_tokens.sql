-- +goose Up

-- ADR-0015: personal read tokens for coach access (API + MCP). Only the
-- SHA-256 of a token is stored; the cascade is the delete-account purge.
create table api_tokens (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references users (id) on delete cascade,
    name         text not null,
    token_hash   bytea not null unique,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz
);

create index api_tokens_user on api_tokens (user_id);

-- +goose Down
drop table api_tokens;
