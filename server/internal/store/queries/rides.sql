-- name: CreateRide :one
-- A session's ride names its crew, the voice channel and the session (#2443);
-- room_id is still written while the channel has a room behind it, for the
-- release that reads it (ADR-0019). A solo ride leaves all four null.
insert into rides (
    user_id, room_id, workout_name, started_at,
    seconds, avg_watts, kj, execution, execution_scored,
    ftp_watts, samples, curve, xp, norm_watts, last20m_hr,
    crew_id, channel_id, session_id
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
returning id;

-- name: ListUserRides :many
-- Summary only: the blob stays on disk unless a single ride is opened.
-- Paged by start (#1549): `before` is the oldest row the caller has, or
-- null for the first page. The delivery state rides along (#1553): a failed
-- Strava upload used to be visible only by opening every ride.
--
-- The cursor carries the id too, and the order breaks the tie on it (#2064).
-- On the timestamp alone the boundary was `started_at < before` against a
-- cursor the client had rounded down to the second, so every ride inside that
-- second went unread — including ones the client had not been given yet. The
-- row comparison is exact, which is the same shape ListUserWorkouts uses.
select rides.id, workout_name, started_at, seconds, avg_watts, kj, execution, execution_scored, ftp_watts, xp, room_id, shared_at,
       e.state as export_state,
       rides.crew_id, coalesce(c.name, '')::text as crew_name,
       rides.channel_id, coalesce(ch.name, '')::text as channel_name
from rides
left join ride_exports e on e.ride_id = rides.id and e.destination = sqlc.arg(destination)::text
left join crews c on c.id = rides.crew_id
left join channels ch on ch.id = rides.channel_id
where user_id = $1
  and (sqlc.narg('before')::timestamptz is null
       or (started_at, rides.id) < (sqlc.narg('before')::timestamptz, sqlc.narg('before_id')::uuid))
order by started_at desc, rides.id desc
limit $2;

-- name: BestUserRideOfWorkout :one
-- The ride page's "against your best" (#1687): the hardest ride of the same
-- workout across the whole history, not the first page of the list. Same
-- columns as ListUserRides so one JSON mapping serves both.
select rides.id, workout_name, started_at, seconds, avg_watts, kj, execution, execution_scored, ftp_watts, xp, room_id, shared_at,
       e.state as export_state,
       rides.crew_id, coalesce(c.name, '')::text as crew_name,
       rides.channel_id, coalesce(ch.name, '')::text as channel_name
from rides
left join ride_exports e on e.ride_id = rides.id and e.destination = sqlc.arg(destination)::text
left join crews c on c.id = rides.crew_id
left join channels ch on ch.id = rides.channel_id
-- `except` is optional (#2249): omitted it arrives as NULL, and `id <> NULL`
-- is NULL rather than true, so every row was filtered out and the route
-- answered "no best ride" for every rider and every workout.
where user_id = $1 and workout_name = $2
  and (sqlc.narg(except_id)::uuid is null or rides.id <> sqlc.narg(except_id))
order by avg_watts desc, started_at desc
limit 1;

-- name: GetRide :one
-- The one per-ride blob read ADR-0016 allows: a rider opening a single ride
-- is exactly what the samples are kept for. Owner-scoped, so someone else's
-- ride reads as absent rather than as forbidden. The room comes along because
-- the detail page names it — empty strings for a solo ride.
select r.*,
       coalesce(rm.slug, '')::text as room_slug,
       coalesce(rm.name, '')::text as room_name,
       coalesce(c.name, '')::text as crew_name,
       coalesce(ch.name, '')::text as channel_name
from rides r
left join rooms rm on rm.id = r.room_id
left join crews c on c.id = r.crew_id
left join channels ch on ch.id = r.channel_id
where r.id = $1 and r.user_id = $2;

-- name: FindRideAt :one
-- The ride a save would duplicate (audit 2026-09-09): a retry after a lost
-- response — the recovery card, the room saver's second attempt — finds the
-- row it already made instead of paying its XP twice. `unique (user_id,
-- started_at)` stands behind it now (#2064): this read still spares the
-- retry an error, but two saves racing each other no longer both insert.
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
-- What one ride won, and where: the room while the medal has one, else its
-- crew (#2443) — a session in a channel no room became has no room at all.
select m.kind, m.awarded_at, coalesce(rm.name, c.name, '')::text as room_name
from medals m
left join rooms rm on rm.id = m.room_id
left join crews c on c.id = m.crew_id
where m.ride_id = $1
order by m.kind;

-- name: CreateMedal :exec
insert into medals (room_id, user_id, ride_id, kind, crew_id)
values ($1, $2, $3, $4, $5);

-- name: ListUserRideWeeks :many
-- Distinct weeks with at least one ride, newest first — the input to the
-- RIDER streak, the one docs/SPEC.md says pays.
-- Truncated in the rider's own zone (#2063), because their week is the week
-- they rode: a Monday 00:30 ride in Zurich is Sunday 23:30 in UTC, which
-- bucketed it into the week before and broke a streak the rider had kept.
-- The zone is named explicitly rather than left to the session, which is how
-- date_trunc on a timestamptz and stats.WeekStreak came to disagree at all
-- (audit 2026-09-09); stats.ZoneName is the one place that picks it, so the
-- SQL and the Go always agree, and it falls back to UTC for a rider whose
-- browser never told us.
-- except_id is the ride being amended (#2253). StreakXP's contract is "read
-- before this ride lands, so this week only counts if already ridden", which
-- save gets for free by asking before the insert. An amendment cannot: the
-- row is already in the table, so its own week came back and the bonus was
-- one week too high. Excluding the ride rather than the week is the same
-- question save asks — a second ride the same week still counts.
select distinct date_trunc('week', started_at at time zone sqlc.arg(tz)::text)::date as week
from rides
where user_id = sqlc.arg(user_id)
  and (sqlc.narg(except_id)::uuid is null or rides.id <> sqlc.narg(except_id))
order by week desc
limit 60;

-- name: ListRoomRideWeeks :many
-- The ROOM streak — the one on screen, and the one that pays nothing.
-- Still UTC, and not by omission: a room's riders are in several zones and a
-- room has no zone of its own, so there is no rider's week to use here. The
-- rider streak moved to the rider's zone in #2063; which zone a room's week
-- belongs to is an open question in that issue.
select distinct date_trunc('week', started_at at time zone 'UTC')::date as week
from rides where room_id = $1
order by week desc
limit 60;

-- name: ListCrewRideWeeks :many
-- The CREW streak (docs/SPEC.md, ADR-0058): weeks in which the crew held a
-- session in any of its voice channels, so two channels in one week are one
-- week. UTC for the room streak's reason — a crew has no zone of its own.
-- Read off rides rather than session_recaps: a recap is pruned at 90 days,
-- which would cap every streak at thirteen weeks, and a ride carries its crew
-- only when it was ridden in one of the crew's sessions (#2431).
select distinct date_trunc('week', started_at at time zone 'UTC')::date as week
from rides where crew_id = $1
order by week desc
limit 60;

-- name: CrewTotals :one
-- RoomCrewTotals at the crew (#2442): sums and counts over the whole crew,
-- sessions as distinct days so an evening split across two voice channels
-- counts once (docs/SPEC.md, Consistency).
select coalesce(sum(seconds), 0)::bigint as seconds,
       count(distinct started_at::date) filter (
         where started_at >= date_trunc('month', now())
       )::bigint as sessions_this_month,
       count(distinct started_at::date) filter (
         where started_at >= date_trunc('month', now()) - interval '1 month'
           and started_at < date_trunc('month', now())
       )::bigint as sessions_last_month
from rides
where crew_id = $1;

-- name: ListCrewSessionDays :many
-- The crew's last session days and whether the caller rode on each — their
-- own turnout and nobody else's (ADR-0036).
select started_at::date as day,
       bool_or(user_id = sqlc.arg(viewer_id)) as attended
from rides
where crew_id = sqlc.arg(crew_id)
group by day
order by day desc
limit 12;

-- name: CrewWeekBoard :many
-- The crew's weekly board (ADR-0036 as amended by ADR-0058): kJ and time in
-- the crew's sessions this week, members only, each on it by their own
-- `on_board`. The handler asks only when the crew has turned it on. The
-- owner is on it by the same row as anyone: one who never answered has none,
-- and is off.
select r.user_id,
       u.display_name,
       u.ftp_watts,
       u.weight_kg,
       u.ftp_source,
       u.weight_source,
       coalesce(sum(r.kj), 0)::bigint as kj,
       coalesce(sum(r.seconds), 0)::bigint as seconds
from rides r
join users u on u.id = r.user_id
join crew_roles cr on cr.crew_id = r.crew_id and cr.user_id = r.user_id
where r.crew_id = $1
  and r.started_at >= (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC')
  and cr.role in ('member', 'admin')
  and cr.on_board
group by r.user_id, u.display_name, u.ftp_watts, u.weight_kg, u.ftp_source, u.weight_source
order by kj desc, u.display_name asc;

-- name: CountCrewMedalsByRider :many
-- Every medal the crew's sessions awarded, per rider — the roster's count.
select user_id, count(*)::int as medals
from medals
where crew_id = $1
group by user_id;

-- name: Best20mIn90Days :one
-- The FTP auto-detect input (docs/SPEC.md): rolling 90-day best 20-minute power.
select coalesce(max((curve->>'best20m')::int), 0)::int from rides
where user_id = $1 and started_at >= now() - interval '90 days';

-- name: BestLast20mHRIn90Days :one
-- The LTHR-from-a-ride input (docs/SPEC.md, #1620): the largest last-20-minute
-- average heart rate among the rider's qualifying rides in the rolling 90 days.
-- Qualifying is SPEC's, and nothing more — solo (no room), at least 30 minutes,
-- and a heart rate in the window. There is deliberately NO power gate: a
-- genuine HR field test need not be near the rider's best 20-minute power.
-- last20m_hr > 0 is what excludes both "no strap" and "not yet backfilled".
select coalesce(max(last20m_hr), 0)::int from rides
where user_id = $1
  and room_id is null
  and seconds >= 1800 -- stats.MinLTHRRideSeconds (docs/SPEC.md's 30 minutes)
  and last20m_hr > 0
  and started_at >= now() - interval '90 days';

-- name: ListRidesMissingLast20mHR :many
-- The #1620 backfill's read, the shape ListRidesMissingNorm uses: each blob is
-- read exactly once and goes cold again, so the per-ride-read storage rule
-- holds. NULL is the only "not computed yet" — a row the backfill has seen
-- carries a number, 0 included.
select id, samples from rides where last20m_hr is null limit $1;

-- name: SetRideLast20mHR :exec
update rides set last20m_hr = $2 where id = $1;

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
-- avg_watts comes too (#2253): a blob that will not decode stores the average
-- the readers' own coalesce would have fallen back to, rather than a 0 that
-- every fallback walks straight past.
select id, samples, avg_watts from rides where norm_watts is null limit $1;

-- name: SetRideNormWatts :exec
update rides set norm_watts = $2 where id = $1;

-- name: ListUserRidesFull :many
-- Export-all (#35): every ride the rider has, summary columns only. The
-- blobs are read one at a time by GetRideSamples below — holding all of them
-- at once grows with how long someone has used WattRoom, which is the one
-- kind of growth an alpha cannot outrun (#894).
--
-- ftp_after_watts comes too (#2089): the ride page shows the number a ramp
-- test produced (ADR-0049) and the export did not, so the one ride that
-- changed the rider's FTP exported as if it had not.
--
-- rpe and note come too (#2328, ADR-0053): they are the only two things on a
-- ride the RIDER wrote, which makes them the least skippable part of a copy
-- of their data. ADR-0055 keeps them off every read that is not the owner's;
-- this is the owner's.
--
-- The crew and the channel come by name (#2443): this is a file the rider
-- reads, and an id is not where they rode.
select r.id, r.workout_name, r.started_at, r.seconds, r.avg_watts, r.kj, r.execution,
       r.execution_scored, r.norm_watts, r.ftp_watts, r.ftp_after_watts, r.xp, r.curve,
       r.room_id, r.shared_at, r.rpe, r.note,
       c.name as crew_name, ch.name as channel_name
from rides r
left join crews c on c.id = r.crew_id
left join channels ch on ch.id = r.channel_id
where r.user_id = $1 order by r.started_at;

-- name: GetRideSamples :one
-- One ride's blob, owner-scoped. The export streams these into the zip one
-- after another, so peak memory is one blob however long the history is.
select samples from rides where id = $1 and user_id = $2;

-- name: DeleteUser :exec
delete from users where id = $1;

-- name: GetRideForUpload :one
-- The uploader's one read: the ride plus the owner's consent flag and the
-- crew for the activity description (null for solo rides, #2443).
select r.id, r.user_id, r.workout_name, r.started_at, r.samples, u.strava_upload,
       r.crew_id, c.name as crew_name
from rides r
join users u on u.id = r.user_id
left join crews c on c.id = r.crew_id
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

-- name: SetRideFeel :execrows
-- What the rider says about a ride, as opposed to what the trainer recorded
-- (#2328): the Borg CR10 rating and the sentence, written together because
-- they are one thing a rider fills in once. NULL clears either — an empty
-- note is no note, and un-rating a ride is a thing riders do.
--
-- Owner-only by the where clause, so someone else's ride reads as absent
-- rather than as forbidden — SetRideShared's rule, and here it is also the
-- only thing standing between a note and a stranger (ADR-0055).
update rides set rpe = sqlc.narg(rpe)::smallint, note = sqlc.narg(note)::text
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
select state, attempts, last_error, remote_id, stale_since
from ride_exports
where ride_id = $1 and destination = $2;

-- name: MarkRideExportStale :exec
-- The ride outgrew what was delivered (#2281). AmendRide rebuilds a saved
-- ride from a longer record after the session closed (#1536); a delivery
-- that already succeeded keeps the short version for good, because
-- StartRideExport refuses to re-open a delivered row and the upload
-- API has no update to re-post through. Nothing here repairs that — the
-- ride page says it, and the rider decides what to do about it.
--
-- `state = 'delivered'` is the whole guard, and it is what makes the notice
-- honest: a ride amended while its upload was still pending diverges from
-- nothing, because the upload that follows carries the grown ride. No
-- destination either — every remote that already has this ride has an old
-- one. Last amendment wins: the stamp is when the two last came apart.
update ride_exports set stale_since = now()
where ride_id = $1 and state = 'delivered';

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

-- name: ForgetRemoteActivityIds :execrows
-- The ids the remote issued for this rider's uploads, dropped when their grant
-- is (#1507). WATTROOM.md binds Strava's API Policy §7.4 — everything goes
-- within 30 days of deauthorization — and an activity id was the one thing
-- here with no delete on any path except a full account purge, so a rider who
-- disconnected Strava and kept WattRoom left Strava-issued identifiers behind
-- for good.
--
-- The delivery row stays. That a ride was uploaded, when, how many tries it
-- took and what it was told is OUR bookkeeping about a ride WE recorded — the
-- ride page reads it, and the export carries it. Only the remote's own number
-- goes with the grant.
--
-- The id does not come back, and nothing pretends otherwise (#2281).
-- `external_id` is ours, so a re-connect's upload still dedupes on Strava's
-- side rather than making a second activity — but no code here reads the
-- answer it dedupes WITH: strava.post turns any `error` in the response into
-- a Go error, and strava.await does the same, so re-sending a ride Strava
-- already has surfaces as a FAILED delivery rather than as the activity it
-- already made. What a rider loses here is the link from the ride page to
-- their activity; what they keep is the activity.
update ride_exports e
set remote_id = null
from rides r
where r.id = e.ride_id
  and r.user_id = $1
  and e.destination = $2
  and e.remote_id is not null;
