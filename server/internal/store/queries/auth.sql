-- No `*` on identities (#1038): sqlc expands it into the generated SQL, so
-- every column stays named in the binary and a later drop would break the
-- rollback to it (ADR-0019). The reads list their columns.

-- name: GetIdentity :one
select provider, provider_user_id, user_id, access_token, token_expires_at, created_at, refresh_token_enc
from identities where provider = $1 and provider_user_id = $2;

-- name: CreateIdentity :exec
insert into identities (provider, provider_user_id, user_id, access_token, refresh_token_enc, token_expires_at)
values ($1, $2, $3, $4, $5, $6);

-- name: UpdateIdentityTokens :exec
update identities
set access_token = $3, refresh_token_enc = $4, token_expires_at = $5
where provider = $1 and provider_user_id = $2;

-- name: CreateSession :exec
insert into sessions (token_hash, user_id, expires_at)
values ($1, $2, $3);

-- name: GetSessionUser :one
select u.*
from sessions s
join users u on u.id = s.user_id
where s.token_hash = $1 and s.expires_at > now();

-- name: DeleteSession :exec
delete from sessions where token_hash = $1;

-- name: DeleteUserSessionsExcept :execrows
-- Every other screen signed in to the account (#1607): the one asking keeps
-- its session — pass a hash no session has to end them all.
delete from sessions where user_id = $1 and token_hash <> $2;

-- name: DeleteExpiredSessions :execrows
-- Bounded (audit 2026-09-09): the caller loops while a batch comes back full.
delete from sessions
 where ctid in (select ctid from sessions where expires_at <= now() limit 10000);

-- name: ListUserProviders :many
select provider from identities where user_id = $1 order by created_at;

-- name: GetUserIdentity :one
select provider, provider_user_id, user_id, access_token, token_expires_at, created_at, refresh_token_enc
from identities where user_id = $1 and provider = $2;

-- name: DeleteIdentity :execrows
delete from identities where user_id = $1 and provider = $2;
