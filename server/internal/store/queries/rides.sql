-- name: CreateRide :one
insert into rides (
    user_id, room_id, workout_name, started_at,
    seconds, avg_watts, kj, execution, ftp_watts, samples, curve, xp, norm_watts
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
returning id;

-- name: ListUserRides :many
-- Summary only: the blob stays on disk unless a single ride is opened.
select id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, xp, room_id, shared_at
from rides
where user_id = $1
order by started_at desc
limit $2;

-- name: GetRide :one
-- The one per-ride blob read ADR-0016 allows: a rider opening a single ride
-- is exactly what the samples are kept for. Owner-scoped, so someone else's
-- ride reads as absent rather than as forbidden. The room comes along because
-- the detail page names it — empty strings for a solo ride.
select r.*,
       coalesce(rm.slug, '')::text as room_slug,
       coalesce(rm.name, '')::text as room_name
from rides r
left join rooms rm on rm.id = r.room_id
where r.id = $1 and r.user_id = $2;

-- name: DeleteRide :execrows
-- Owner-only by the where clause. The medals awarded for this ride go with
-- it through medals.ride_id's on-delete-cascade — no cleanup pass to forget.
delete from rides where id = $1 and user_id = $2;

-- name: ListRideMedals :many
-- What one ride won. A medal is always a room's, so the room names itself
-- here rather than being looked up a second time.
select m.kind, m.awarded_at, rm.name as room_name
from medals m
join rooms rm on rm.id = m.room_id
where m.ride_id = $1
order by m.kind;

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

-- name: Best20mIn90Days :one
-- The FTP auto-detect input (docs/SPEC.md): rolling 90-day best 20-minute power.
select coalesce(max((curve->>'best20m')::int), 0)::int from rides
where user_id = $1 and started_at >= now() - interval '90 days';

-- name: CurveBests :one
-- Progression overlay (#222): best per SPEC curve window over three ranges,
-- summary columns only — the sample blob stays cold.
select
    coalesce(max((curve->>'best5s')::int)  filter (where started_at >= now() - interval '30 days'), 0)::int as d30_best5s,
    coalesce(max((curve->>'best1m')::int)  filter (where started_at >= now() - interval '30 days'), 0)::int as d30_best1m,
    coalesce(max((curve->>'best5m')::int)  filter (where started_at >= now() - interval '30 days'), 0)::int as d30_best5m,
    coalesce(max((curve->>'best20m')::int) filter (where started_at >= now() - interval '30 days'), 0)::int as d30_best20m,
    coalesce(max((curve->>'best5s')::int)  filter (where started_at >= now() - interval '90 days'), 0)::int as d90_best5s,
    coalesce(max((curve->>'best1m')::int)  filter (where started_at >= now() - interval '90 days'), 0)::int as d90_best1m,
    coalesce(max((curve->>'best5m')::int)  filter (where started_at >= now() - interval '90 days'), 0)::int as d90_best5m,
    coalesce(max((curve->>'best20m')::int) filter (where started_at >= now() - interval '90 days'), 0)::int as d90_best20m,
    coalesce(max((curve->>'best5s')::int),  0)::int as all_best5s,
    coalesce(max((curve->>'best1m')::int),  0)::int as all_best1m,
    coalesce(max((curve->>'best5m')::int),  0)::int as all_best5m,
    coalesce(max((curve->>'best20m')::int), 0)::int as all_best20m
from rides
where user_id = $1;

-- name: ListUserProgression :many
-- Per-ride trend rows, oldest first (#222): ftp_watts was captured at ride
-- time, so FTP history is free; best20m feeds the Category/w-kg trend.
-- norm_watts falls back to avg_watts for rides the backfill has not reached.
select id, started_at, seconds, kj, execution, ftp_watts,
       coalesce((curve->>'best20m')::int, 0)::int as best20m,
       coalesce(norm_watts, avg_watts)::int as norm_watts
from rides
where user_id = $1 and started_at >= now() - interval '365 days'
order by started_at
limit 1000;

-- name: ListRidesMissingNorm :many
-- The ADR-0016 backfill's read: each blob is read exactly once, then goes
-- cold again — the per-ride-read storage rule holds.
select id, samples from rides where norm_watts is null limit $1;

-- name: SetRideNormWatts :exec
update rides set norm_watts = $2 where id = $1;

-- name: ListUserRidesFull :many
-- Export-all (#35): everything, blobs included — this is the one query
-- allowed to read every blob, because the rider is taking their data home.
select * from rides where user_id = $1 order by started_at;

-- name: DeleteUser :exec
delete from users where id = $1;

-- name: GetRideForUpload :one
-- The uploader's one read: the ride plus the owner's consent flag.
select r.id, r.user_id, r.workout_name, r.started_at, r.samples, u.strava_upload
from rides r join users u on u.id = r.user_id
where r.id = $1;

-- name: UserTotalXp :one
-- #253: lifetime XP → level (docs/SPEC.md thresholds, computed client-side).
-- Rides plus the off-bike ledger (#467) — user_total_xp is the one definition.
select user_total_xp($1)::bigint;

-- name: SetRideShared :execrows
-- Per-ride opt-in (WATTROOM.md privacy): the owner flips it, the timestamp
-- remembers when; unsharing clears it. Owner-only by the where clause.
update rides
set shared_at = case when sqlc.arg(shared)::boolean then coalesce(shared_at, now()) else null end
where id = sqlc.arg(id) and user_id = sqlc.arg(user_id);
