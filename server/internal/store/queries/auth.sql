-- name: GetIdentity :one
select * from identities where provider = $1 and provider_user_id = $2;

-- name: CreateIdentity :exec
insert into identities (provider, provider_user_id, user_id, access_token, refresh_token, refresh_token_enc, token_expires_at)
values ($1, $2, $3, $4, $5, $6, $7);

-- name: UpdateIdentityTokens :exec
update identities
set access_token = $3, refresh_token = $4, refresh_token_enc = $5, token_expires_at = $6
where provider = $1 and provider_user_id = $2;

-- Rows still holding a plaintext refresh token, for the one-time backfill
-- (#697). Bounded by the number of third-party connections, not by riders.
-- name: ListPlaintextRefreshTokens :many
select provider, provider_user_id, refresh_token from identities
where refresh_token is not null and refresh_token <> '' and refresh_token_enc is null;

-- Seal one row in place. The plaintext goes in the same statement it is
-- replaced by, so a crash mid-backfill leaves every row either sealed or
-- untouched, never neither.
-- name: SealRefreshToken :exec
update identities set refresh_token_enc = $3, refresh_token = null
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

-- name: DeleteExpiredSessions :exec
delete from sessions where expires_at <= now();

-- name: ListUserProviders :many
select provider from identities where user_id = $1 order by created_at;

-- name: GetUserIdentity :one
select * from identities where user_id = $1 and provider = $2;

-- name: DeleteIdentity :execrows
delete from identities where user_id = $1 and provider = $2;
