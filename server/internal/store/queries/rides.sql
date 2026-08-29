-- name: CreateRide :one
insert into rides (
    user_id, room_id, workout_name, started_at,
    seconds, avg_watts, kj, execution, ftp_watts, samples
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
