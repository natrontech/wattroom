-- name: CreateUser :one
-- email_required is true for every account created from #781 on: a new rider
-- verifies an address, an existing one is only asked.
--
-- Both sources are 'default' here and nowhere else (#1484): the FTP and weight
-- the caller passes are the app's opening guess, not the rider's answer, and
-- everything downstream — the first-run step, Home's label — reads that word
-- rather than re-deriving it from "is it still 200".
insert into users (display_name, avatar_url, ftp_watts, weight_kg, email_required,
                   ftp_source, weight_source)
values ($1, $2, $3, $4, true, 'default', 'default')
returning *;

-- name: GetUser :one
select * from users where id = $1;

-- name: UpdateUserProfile :one
-- Never `email`: the address moves in VerifyEmail and leaves in
-- ClearUserEmail. Writing it back from the handler's snapshot let a confirm
-- click landing mid-save be overwritten by the old address, with
-- email_verified_at still set (#824).
--
-- The two sources travel with the two numbers (#1484). The handler decides the
-- word — a rider answering the ask, a ramp test, or the value simply not
-- having changed — so this statement only stores it.
update users
set display_name = $2, ftp_watts = $3, weight_kg = $4, strava_upload = $5,
    notify_planned = $6, lthr = sqlc.narg('lthr')::smallint,
    ftp_source = $7, weight_source = $8
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
where m.room_id = $1 and m.role != 'banned' and m.notify and u.notify_planned
  -- The crew's ban too (#1904), which the membership row does not carry.
  and exists (select 1 from visible_rooms v where v.room_id = m.room_id and v.user_id = m.user_id)
  -- ADR-0030: nothing but its own confirmation reaches an unverified address.
  -- Every current writer of email verifies first; the predicate makes the
  -- rule structural rather than an accident of write order (audit 2026-09-09).
  and u.email is not null and u.email_verified_at is not null and u.id <> $2;

-- name: UserTimezone :one
-- The zone a rider's own days are bucketed in (#2063) — nullable, so the
-- caller falls back to UTC (stats.Zone). One column rather than GetUser
-- because this runs per rider on every session save.
select timezone from users where id = $1;

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

-- name: SetUserAvatar :one
-- The picture and the address that reaches it, in one statement (#1353): the
-- bytes land in user_avatars and avatar_url is repointed at them, versioned by
-- set_at so a replaced picture has a new address everywhere at once.
with saved as (
    insert into user_avatars (user_id, mime, image, set_at)
    values ($1, $2, $3, $4)
    on conflict (user_id) do update
        set mime = excluded.mime, image = excluded.image, set_at = excluded.set_at
)
update users set avatar_url = $5 where id = $1
returning *;

-- name: GetUserAvatar :one
select mime, image, set_at from user_avatars where user_id = $1;
