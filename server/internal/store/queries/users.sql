-- name: CreateUser :one
insert into users (display_name, avatar_url, ftp_watts, weight_kg)
values ($1, $2, $3, $4)
returning *;

-- name: GetUser :one
select * from users where id = $1;

-- name: UpdateUserProfile :one
update users
set display_name = $2, ftp_watts = $3, weight_kg = $4, strava_upload = $5,
    email = $6, notify_planned = $7
where id = $1
returning *;

-- name: UnsubscribePlanned :execrows
update users set notify_planned = false where id = $1 and unsub_token = $2;

-- name: ListRoomNotifyTargets :many
-- Members who asked for planned-session email — minus the planner, who knows.
select u.id, u.email, u.unsub_token
from memberships m
join users u on u.id = m.user_id
where m.room_id = $1 and u.notify_planned and u.email is not null and u.id <> $2;
