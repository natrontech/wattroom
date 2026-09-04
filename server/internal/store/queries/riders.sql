-- A rider's page (ADR-0024): what rooms already see, plus what the rider
-- chose to share. Every query here takes the viewer as well as the rider,
-- because the room boundary decides what comes back.

-- name: ListRoomsInCommon :many
-- Rooms where both hold a live (non-banned) membership — the gate for the
-- whole page, and the scope of the medals shown on it.
select r.id, r.slug, r.name
from rooms r
join memberships a on a.room_id = r.id and a.user_id = sqlc.arg(rider) and a.role != 'banned'
join memberships b on b.room_id = r.id and b.user_id = sqlc.arg(viewer) and b.role != 'banned'
order by r.name;

-- name: RiderTotals :one
-- Lifetime: XP (level), energy (kJ) and the ride count. Sums only — no
-- watts, no heart rate, nothing per ride.
-- XP is user_total_xp, never sum(rides.xp) (#690): the ledger (#467) pays
-- for lounge time, voice sessions and achievements, and summing rides
-- alone showed a rider's own profile a lower level than the sidebar,
-- the room and their DMs — the one page that is ABOUT the level.
select count(*)::bigint as rides,
       coalesce(sum(kj), 0)::bigint as total_kj,
       user_total_xp($1)::bigint as total_xp
from rides where user_id = $1;

-- name: RiderMonth :one
-- This month's totals — friends only (ADR-0024).
select count(*)::bigint as rides,
       coalesce(sum(seconds), 0)::bigint as seconds,
       coalesce(sum(kj), 0)::bigint as kj
from rides
where user_id = $1 and started_at >= date_trunc('month', now());

-- name: CountRiderMedalsInCommon :many
-- Medals the rider earned in rooms the viewer shares with them, by kind.
-- Rooms they have since left are not "rooms you share" any more.
select m.kind, count(*)::bigint as count
from medals m
join memberships a on a.room_id = m.room_id and a.user_id = sqlc.arg(rider) and a.role != 'banned'
join memberships b on b.room_id = m.room_id and b.user_id = sqlc.arg(viewer) and b.role != 'banned'
where m.user_id = sqlc.arg(rider)
group by m.kind
order by m.kind;

-- name: ListSharedRides :many
-- The rides the rider marked shared, newest first — friends only. The room
-- is named only when the viewer is a member of it (ADR-0012: friendship
-- never pierces the room boundary); otherwise the ride just "was in a room".
select r.id, r.workout_name, r.started_at, r.seconds, r.kj, r.execution,
       (r.room_id is not null)::boolean as in_room,
       coalesce(case when v.user_id is not null then rm.name end, '')::text as room_name,
       coalesce((select string_agg(m.kind, ' ' order by m.kind) from medals m where m.ride_id = r.id), '')::text as medal_kinds
from rides r
left join rooms rm on rm.id = r.room_id
left join memberships v on v.room_id = r.room_id and v.user_id = sqlc.arg(viewer) and v.role != 'banned'
where r.user_id = sqlc.arg(rider) and r.shared_at is not null
order by r.started_at desc
limit sqlc.arg(max);
