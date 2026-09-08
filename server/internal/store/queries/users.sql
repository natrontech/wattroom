-- name: CreateUser :one
-- email_required is true for every account created from #781 on: a new rider
-- verifies an address, an existing one is only asked.
insert into users (display_name, avatar_url, ftp_watts, weight_kg, email_required)
values ($1, $2, $3, $4, true)
returning *;

-- name: GetUser :one
select * from users where id = $1;

-- name: UpdateUserProfile :one
-- Never `email`: the address moves in VerifyEmail and leaves in
-- ClearUserEmail. Writing it back from the handler's snapshot let a confirm
-- click landing mid-save be overwritten by the old address, with
-- email_verified_at still set (#824).
update users
set display_name = $2, ftp_watts = $3, weight_kg = $4, strava_upload = $5,
    notify_planned = $6, avatar_preset = $7
where id = $1
returning *;

-- name: UnsubscribePlanned :execrows
update users set notify_planned = false where id = $1 and unsub_token = $2;

-- name: ListRoomNotifyTargets :many
-- Members who asked for planned-session email — minus the planner, who knows.
-- The zone comes along because the time in the mail is formatted per rider
-- (#858), not once for the whole room.
--
-- Two switches, both of which must be on (#1100): `u.notify_planned` is the
-- rider's global answer and `m.notify` is their answer for THIS room. The
-- per-room one narrows the global rather than overriding it — a rider who
-- has turned planned-session mail off everywhere does not start getting it
-- again by joining somewhere.
select u.id, u.email, u.unsub_token, u.timezone
from memberships m
join users u on u.id = m.user_id
where m.room_id = $1 and m.notify and u.notify_planned
  and u.email is not null and u.id <> $2;

-- name: UpdateUserTimezone :exec
-- Reported by the browser, never typed. Its own statement rather than a field
-- on the profile update, because that one validates a whole form and this is a
-- background write of one value.
update users set timezone = $2 where id = $1;

-- name: GetUserByIcsToken :one
select * from users where ics_token = $1;

-- name: RotateUserIcsToken :one
update users set ics_token = replace(gen_random_uuid()::text, '-', '')
where id = $1 returning ics_token;

-- name: UpdateUserAppearance :one
update users set accent_palette = $2, color_scheme = $3 where id = $1 returning *;

-- name: StartEmailVerification :one
-- Writes the pending address and the token, never `email` — the address only
-- moves across in VerifyEmail. Replaces any verification already in flight.
update users
set email_pending = $2, email_verify_hash = $3, email_verify_expires = $4
where id = $1
returning *;

-- name: UserByEmailVerifyHash :one
-- A read-only peek at the row a confirmation link is about to promote, so the
-- address being replaced can be told it is being replaced (#840). The
-- verification itself is still VerifyEmail's single-use update; this only
-- answers "whose link is this, and what address does the account hold now".
select * from users where email_verify_hash = $1 and email_verify_expires > now();

-- name: VerifyEmail :one
-- Single use and time-bounded: the row that matches is also the row that
-- clears the token, so a replayed link finds nothing.
update users
set email = email_pending,
    email_verified_at = now(),
    email_pending = null,
    email_verify_hash = null,
    email_verify_expires = null
where email_verify_hash = $1 and email_verify_expires > now()
returning *;

-- name: ClearUserEmail :one
-- Removing the address takes the verification and anything in flight with it.
update users
set email = null, email_verified_at = null, email_pending = null,
    email_verify_hash = null, email_verify_expires = null, notify_planned = false
where id = $1
returning *;

-- name: EmailVerifiedElsewhere :one
select exists (
    select 1 from users
    where lower(email) = lower(@email::text)
      and email_verified_at is not null
      and id <> @user_id
);
