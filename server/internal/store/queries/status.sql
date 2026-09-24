-- A rider's status (ADR-0060, #2694). What the status reads as is decided in
-- Go (status.Of): a cleared time in the past is no status, so no statement
-- here needs to know the clock.

-- name: SetUserStatus :exec
update users
set status_emoji = sqlc.narg(emoji),
    status_emoji_id = sqlc.narg(emoji_id),
    status_text = sqlc.narg(text),
    status_expires_at = sqlc.narg(expires_at)
where id = sqlc.arg(id);

-- name: ClearUserStatus :exec
update users
set status_emoji = null, status_emoji_id = null, status_text = null, status_expires_at = null
where id = $1;

-- name: WearableCrewEmoji :one
-- A crew emoji's name, if the rider may wear it: one from a crew they belong
-- to (its owner, or a member or admin — never banned). Anything else is no
-- row, which the handler answers as a validation error rather than telling a
-- rider which crews hold which emoji.
select e.name
from crew_emoji e
join crews c on c.id = e.crew_id
where e.id = sqlc.arg(id)
  and (c.owner_id = sqlc.arg(user_id)
       or exists (select 1 from crew_roles cr
                  where cr.crew_id = e.crew_id and cr.user_id = sqlc.arg(user_id)
                    and cr.role <> 'banned'));

-- name: WornCrewEmojiImage :one
-- The picture of a crew emoji somebody wears in a status that has not
-- cleared (ADR-0060): readable outside its crew for exactly that long.
select e.mime, e.bytes
from crew_emoji e
where e.id = $1
  and exists (select 1 from users u
              where u.status_emoji_id = e.id
                and (u.status_expires_at is null or u.status_expires_at > now()));
