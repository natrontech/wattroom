-- name: CreateToken :one
insert into api_tokens (user_id, name, token_hash)
values ($1, $2, $3)
returning id, created_at;

-- name: ListUserTokens :many
select id, name, created_at, last_used_at
from api_tokens where user_id = $1
order by created_at desc;

-- name: DeleteToken :execrows
delete from api_tokens where id = $1 and user_id = $2;

-- name: GetUserByTokenHash :one
-- The bearer-auth lookup (ADR-0015): hash in, owner out.
select u.* from users u
join api_tokens t on t.user_id = u.id
where t.token_hash = $1;

-- name: TouchToken :exec
update api_tokens set last_used_at = now() where token_hash = $1;
