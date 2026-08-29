-- name: GetIdentity :one
select * from identities where provider = $1 and provider_user_id = $2;

-- name: CreateIdentity :exec
insert into identities (provider, provider_user_id, user_id, access_token, refresh_token, token_expires_at)
values ($1, $2, $3, $4, $5, $6);

-- name: UpdateIdentityTokens :exec
update identities
set access_token = $3, refresh_token = $4, token_expires_at = $5
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
