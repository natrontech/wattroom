-- name: CreateRide :one
insert into rides (
    user_id, room_id, workout_name, started_at,
    seconds, avg_watts, kj, execution, execution_scored,
    ftp_watts, samples, curve, xp, norm_watts
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
returning id;

-- name: ListUserRides :many
-- Summary only: the blob stays on disk unless a single ride is opened.
-- Paged by start (#1549): `before` is the oldest row the caller has, or
-- null for the first page. The delivery state rides along (#1553): a failed
-- Strava upload used to be visible only by opening every ride.
select rides.id, workout_name, started_at, seconds, avg_watts, kj, execution, execution_scored, ftp_watts, xp, room_id, shared_at,
       e.state as export_state
from rides
left join ride_exports e on e.ride_id = rides.id and e.destination = sqlc.arg(destination)::text
where user_id = $1
  and (sqlc.narg('before')::timestamptz is null or started_at < sqlc.narg('before')::timestamptz)
order by started_at desc
limit $2;

-- name: BestUserRideOfWorkout :one
-- The ride page's "against your best" (#1687): the hardest ride of the same
-- workout across the whole history, not the first page of the list. Same
-- columns as ListUserRides so one JSON mapping serves both.
select rides.id, workout_name, started_at, seconds, avg_watts, kj, execution, execution_scored, ftp_watts, xp, room_id, shared_at,
       e.state as export_state
from rides
left join ride_exports e on e.ride_id = rides.id and e.destination = sqlc.arg(destination)::text
where user_id = $1 and workout_name = $2 and rides.id <> $3
order by avg_watts desc, started_at desc
limit 1;

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

-- name: FindRideAt :one
-- The ride a save would duplicate (audit 2026-09-09): a retry after a lost
-- response — the recovery card, the room saver's second attempt — finds the
-- row it already made instead of paying its XP twice.
select id from rides where user_id = $1 and started_at = $2 limit 1;

-- name: DeleteRide :execrows
-- Owner-only by the where clause. The medals awarded for this ride go with
-- it through medals.ride_id's on-delete-cascade — no cleanup pass to forget.
--
-- The XP does NOT go with it (#1452, ADR-0047): the ride was ridden, and
-- deleting the record is privacy, not un-riding. One statement, so the delete
-- and its offsetting ledger row cannot come apart — the ride leaves
-- `sum(rides.xp)` and the `ride_deleted` row puts the same amount back, which
-- leaves `user_total_xp` (rides + ledger) exactly where it was and the level
-- where docs/SPEC.md says it stays. `ref` is the ride's id, so the ledger's
-- unique (user, source, ref) makes a replay impossible to double-count; no
-- `on conflict do nothing` here on purpose, because swallowing a collision
-- would report the delete as a 404 it did not get. `at` defaults to now(),
-- the moment of the delete — carrying the ride's own `started_at` over would
-- put "when this rider rode" back into a row the rider asked to be rid of.
with gone as (
    delete from rides where rides.id = $1 and rides.user_id = $2
    returning rides.id as ride_id, rides.user_id as rider, rides.xp as xp
)
insert into xp_events (user_id, source, amount, ref)
select gone.rider, 'ride_deleted', gone.xp, gone.ride_id::text from gone;

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
-- The rider's id and the moment travel with it (#1411): the client matched
-- its own medal by display name and a UTC date, which found nothing after
-- local midnight and could name the wrong rider.
select m.kind, m.awarded_at, m.user_id, u.display_name
from medals m
join users u on u.id = m.user_id
where m.room_id = $1
order by m.awarded_at desc
limit $2;

-- name: CountRoomMedalsByRider :many
-- Every medal this room ever awarded, per rider — the roster's count. The
-- recent list above is capped and carries names; a count matched on those
-- decayed as the room rode and merged two riders with one name (#1371).
select user_id, count(*)::int as medals
from medals
where room_id = $1
group by user_id;

-- name: ListUserRideWeeks :many
-- Distinct ISO weeks with at least one ride, newest first — the streak input.
-- Truncated at UTC, which is where stats.WeekStreak re-buckets: date_trunc
-- on a timestamptz otherwise runs in the session's zone and the two disagreed
-- (audit 2026-09-09).
select distinct date_trunc('week', started_at at time zone 'UTC')::date as week
from rides where user_id = $1
order by week desc
limit 60;

-- name: ListRoomRideWeeks :many
-- Truncated at UTC, which is where stats.WeekStreak re-buckets: date_trunc
-- on a timestamptz otherwise runs in the session's zone and the two disagreed
-- (audit 2026-09-09).
select distinct date_trunc('week', started_at at time zone 'UTC')::date as week
from rides where room_id = $1
order by week desc
limit 60;

-- name: RoomMonthKj :one
-- The collective challenge number: this month's kJ, together.
select coalesce(sum(kj), 0)::bigint from rides
where room_id = $1 and started_at >= date_trunc('month', now());

-- name: RoomCrewTotals :one
-- What the crew did together (#995, RESEARCH.md §14.7). Cooperative by
-- construction: every figure is a sum or a count over the whole room, so
-- nobody is ranked inside any of it. Sessions are counted as distinct days
-- rather than rides, because six riders in one session is one session.
select coalesce(sum(seconds), 0)::bigint as seconds,
       count(distinct started_at::date) filter (
         where started_at >= date_trunc('month', now())
       )::bigint as sessions_this_month,
       count(distinct started_at::date) filter (
         where started_at >= date_trunc('month', now()) - interval '1 month'
           and started_at < date_trunc('month', now())
       )::bigint as sessions_last_month
from rides
where room_id = $1;

-- name: ListRoomSessionDays :many
-- The room's last sessions, newest first, and whether the caller was in each
-- (#995). A day rather than a ride: one evening the crew rode together is one
-- dot, however many of them were there. Describes the caller's own turnout and
-- nobody else's — RESEARCH.md §14.8 forbids grading attendance.
select started_at::date as day,
       bool_or(user_id = sqlc.arg(viewer_id)) as attended
from rides
where room_id = sqlc.arg(room_id)
group by day
order by day desc
limit 12;

-- name: RoomWeekBoard :many
-- The room's ordered board (#995, ADR-0036) — opt-in, and THIS WEEK ONLY.
-- The week is the streak's week (Monday-start, date_trunc('week')), so a bad
-- week is never permanent: RESEARCH.md §14.3 names the stable ordering a
-- standing crew cannot re-randomise as the failure mode every cited product
-- avoids by resetting. Members only; the handler proves the room, this proves
-- the rider is still in it.
select r.user_id,
       u.display_name,
       u.ftp_watts,
       u.weight_kg,
       coalesce(sum(r.kj), 0)::bigint as kj,
       coalesce(sum(r.seconds), 0)::bigint as seconds
from rides r
join users u on u.id = r.user_id
join memberships m on m.room_id = r.room_id and m.user_id = r.user_id
where r.room_id = $1
  and r.started_at >= (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC')
  and m.role <> 'banned'
  -- A rider's own opt-out (#1100, amending ADR-0036). The room-level switch
  -- answers "joining a room must not put you on a board"; this answers the
  -- same trap one level up, where the owner turns the board on and everybody
  -- already inside is enrolled by existence.
  and m.on_board
group by r.user_id, u.display_name, u.ftp_watts, u.weight_kg
order by kj desc, u.display_name asc;

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
select id, started_at, seconds, kj, execution, execution_scored, ftp_watts,
       -- The FTP this ride PRODUCED, null on all but a ramp whose number was
       -- accepted (#1572) — the trend marks it on the ramp's own ride.
       ftp_after_watts,
       coalesce((curve->>'best20m')::int, 0)::int as best20m,
       coalesce(norm_watts, avg_watts)::int as norm_watts
from rides
where user_id = $1 and started_at >= now() - interval '365 days'
-- Newest first under the bound (#1689): ascending with a limit dropped the
-- newest rides for anyone past it. The caller reverses.
order by started_at desc
limit 1000;

-- name: FirstRideAt :one
-- The rider's first saved ride, for SPEC's 28-day cold start (#1689): the
-- oldest row inside the year window was not it after a long break.
select min(started_at)::timestamptz as first_ride from rides where user_id = $1;

-- name: ListRidesMissingNorm :many
-- The ADR-0016 backfill's read: each blob is read exactly once, then goes
-- cold again — the per-ride-read storage rule holds.
select id, samples from rides where norm_watts is null limit $1;

-- name: SetRideNormWatts :exec
update rides set norm_watts = $2 where id = $1;

-- name: ListUserRidesFull :many
-- Export-all (#35): every ride the rider has, summary columns only. The
-- blobs are read one at a time by GetRideSamples below — holding all of them
-- at once grows with how long someone has used WattRoom, which is the one
-- kind of growth an alpha cannot outrun (#894).
select id, workout_name, started_at, seconds, avg_watts, kj, execution,
       execution_scored, norm_watts, ftp_watts, xp, curve, room_id, shared_at
from rides where user_id = $1 order by started_at;

-- name: GetRideSamples :one
-- One ride's blob, owner-scoped. The export streams these into the zip one
-- after another, so peak memory is one blob however long the history is.
select samples from rides where id = $1 and user_id = $2;

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

-- name: SetRideFtpAfter :execrows
-- The number a ramp test produced, on the ramp's own ride (#1572). Owner-only
-- by the where clause, so someone else's ride reads as absent rather than as
-- forbidden. Last write wins: re-testing the same ride is not a thing, and a
-- retried stamp must land on the row it already wrote.
update rides set ftp_after_watts = sqlc.arg(ftp_after_watts)::smallint
where id = sqlc.arg(id) and user_id = sqlc.arg(user_id);

-- name: SetRideShared :execrows
-- Per-ride opt-in (WATTROOM.md privacy): the owner flips it, the timestamp
-- remembers when; unsharing clears it. Owner-only by the where clause.
update rides
set shared_at = case when sqlc.arg(shared)::boolean then coalesce(shared_at, now()) else null end
where id = sqlc.arg(id) and user_id = sqlc.arg(user_id);

-- name: StartRideExport :exec
-- Opens (or re-opens) the delivery record for one ride and destination. A
-- retry lands on the same row: one delivery per pair, ever (#799).
insert into ride_exports (ride_id, destination, state, attempts, updated_at)
values ($1, $2, 'pending', 0, now())
on conflict (ride_id, destination) do update
    set state = 'pending', updated_at = now()
    where ride_exports.state <> 'delivered';

-- name: FinishRideExport :exec
-- The remote has it. remote_id is the activity it became.
update ride_exports
set state = 'delivered', remote_id = $3, last_error = null, updated_at = now()
where ride_id = $1 and destination = $2;

-- name: FailRideExport :exec
-- One attempt spent. Past the ceiling the row stops being swept and the
-- rider is told, rather than retried at forever.
update ride_exports
set attempts = attempts + 1,
    last_error = $3,
    state = case when attempts + 1 >= sqlc.arg(max_attempts)::int then 'failed' else 'pending' end,
    updated_at = now()
where ride_id = $1 and destination = $2;

-- name: ListRideExportsDue :many
-- The sweep: deliveries still owed a try, quiet for long enough that the last
-- failure is not being repeated immediately. Bounded — a backlog drains over
-- several sweeps rather than in one burst of uploads.
select ride_id, destination, attempts, updated_at
from ride_exports
where state = 'pending' and updated_at < sqlc.arg(before)::timestamptz
order by updated_at
limit sqlc.arg(max_rows)::int;

-- name: GetRideExport :one
select state, attempts, last_error, remote_id
from ride_exports
where ride_id = $1 and destination = $2;

-- name: RequeueRideExport :execrows
-- The rider pressing "try again" on a delivery that ran out of attempts
-- (#1158). Back to pending with the counter cleared, so the ordinary sweep
-- picks it up on its next pass and no second code path exists.
--
-- `state = 'failed'` is the guard, not decoration: a delivery still pending
-- is already going to be tried, and one that succeeded must not be re-sent —
-- pressing a stale button twice would put the ride on Strava twice.
update ride_exports
set state = 'pending', attempts = 0, last_error = null, updated_at = now()
where ride_id = $1 and destination = $2 and state = 'failed';

-- name: AmendRide :execrows
-- A saved ride grown from a longer record (#1536): a socket that dropped
-- before the close and replayed its buffer after it. Only ever longer —
-- a replay of what was already saved changes nothing — and the medals
-- stay as awarded; xp moves with the row, which user_total_xp sums live.
update rides
set seconds = $2, avg_watts = $3, kj = $4, execution = $5, execution_scored = $6,
    samples = $7, curve = $8, xp = $9, norm_watts = $10
where id = $1 and seconds < $2;
