-- name: CreateRide :one
insert into rides (
    user_id, room_id, workout_name, started_at,
    seconds, avg_watts, kj, execution, ftp_watts, samples, curve, xp
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
returning id;

-- name: ListUserRides :many
-- Summary only: the blob stays on disk unless a single ride is opened.
select id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, shared_at
from rides
where user_id = $1
order by started_at desc
limit $2;

-- name: GetRide :one
select * from rides where id = $1 and user_id = $2;

-- name: CreateMedal :exec
insert into medals (room_id, user_id, ride_id, kind)
values ($1, $2, $3, $4);

-- name: ListRoomMedals :many
select m.kind, m.awarded_at, u.display_name
from medals m
join users u on u.id = m.user_id
where m.room_id = $1
order by m.awarded_at desc
limit $2;

-- name: ListUserRideWeeks :many
-- Distinct ISO weeks with at least one ride, newest first — the streak input.
select distinct date_trunc('week', started_at)::date as week
from rides where user_id = $1
order by week desc
limit 60;

-- name: ListRoomRideWeeks :many
select distinct date_trunc('week', started_at)::date as week
from rides where room_id = $1
order by week desc
limit 60;

-- name: RoomMonthKj :one
-- The collective challenge number: this month's kJ, together.
select coalesce(sum(kj), 0)::bigint from rides
where room_id = $1 and started_at >= date_trunc('month', now());
