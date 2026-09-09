-- +goose Up
-- A rider's own picture (#1353): one small blob per rider, its own table so
-- `select * from users` — every authenticated request — never drags the bytes
-- along. Postgres, not an object store (ADR-0002: single VM), bounded by the
-- same 2 MB the chat image reader enforces. users.avatar_url points at
-- /api/riders/{id}/avatar?v=<set_at> once one is uploaded, so every reader of
-- that column shows it unchanged. users.avatar_preset stays until the release
-- after this one (expand/contract, ADR-0019) — nothing reads it any more.
create table user_avatars (
    user_id uuid primary key references users(id) on delete cascade,
    mime text not null,
    image bytea not null,
    set_at timestamptz not null default now()
);

-- +goose Down
drop table user_avatars;
