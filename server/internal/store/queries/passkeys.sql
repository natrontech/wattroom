-- name: CreatePasskey :one
insert into passkeys (credential_id, user_id, credential, name)
values ($1, $2, $3, $4)
returning *;

-- name: ListUserPasskeys :many
select * from passkeys where user_id = $1 order by created_at;

-- name: GetPasskey :one
select * from passkeys where credential_id = $1;

-- name: TouchPasskey :exec
-- Every login rewrites the record: the signature counter inside it moves, and
-- go-webauthn hands back the credential it validated with.
update passkeys
set credential = $2, last_used_at = now()
where credential_id = $1;

-- name: RenamePasskey :one
update passkeys set name = $3 where credential_id = $1 and user_id = $2
returning *;

-- name: DeletePasskey :execrows
delete from passkeys where credential_id = $1 and user_id = $2;

-- name: CountUserCredentials :one
-- Providers and passkeys together: what a rider can never take to zero
-- (ADR-0029). One query so the passkey and provider removal paths cannot
-- disagree about what "last credential" means.
select (select count(*) from identities i where i.user_id = @user_id)
     + (select count(*) from passkeys p where p.user_id = @user_id) as total;
