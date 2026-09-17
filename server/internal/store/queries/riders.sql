-- A rider's page (ADR-0024): what rooms already see, plus what the rider
-- chose to share. Every query here takes the viewer as well as the rider,
-- because the room boundary decides what comes back.
--
-- That boundary is `visible_rooms` and nothing here re-derives it (ADR-0038,
-- third amendment). The joins used to spell `role != 'banned'` by hand, which
-- is exactly how #1109 and #1114 happened — four such joins, one of them
-- missing the guard. The view also carries what a hand-written join could not
-- have known about: crew visibility, private-room grants and the crew ban.

-- name: ListRoomsInCommon :many
-- Rooms both may enter (`visible_rooms`) — the gate for the whole page, and
-- the scope of the medals shown on it. Since ADR-0038's person-visibility
-- section this is wider than "both joined it" on purpose: a crew-visible
-- room neither has joined still puts two riders in common.
select r.id, r.slug, r.name
from rooms r
join visible_rooms a on a.room_id = r.id and a.user_id = sqlc.arg(rider)
join visible_rooms b on b.room_id = r.id and b.user_id = sqlc.arg(viewer)
order by r.name;

-- name: SharesRoomOrFriends :one
-- ADR-0024's audience for a rider's page, as ONE question (#2298). A shared
-- live room, an accepted friendship, a pending request from them — or the
-- rider themselves.
--
-- Both routes that serve this audience ask THIS: riders.handleGet for the
-- page, gamify.handleRider for the trophy case on it. They used to decide it
-- separately — one composing ListRoomsInCommon with friendStatus in Go, the
-- other calling this — and agreed only by coincidence. The failure was the
-- quiet direction: a new room state that counts as shared, or a friendship
-- state that should not, would have moved one and left the other answering
-- for an audience the ADR never granted.
select (
    -- Your own page is yours, whatever rooms or friends you have. Stated
    -- here rather than at each call site, which is what made this two rules.
    @viewer::uuid = @rider::uuid
    or exists (
        -- `visible_rooms` is the boundary, not a hand-written membership join
        -- (ADR-0038, third amendment). #1110 fixed this very query for missing
        -- `role != 'banned'`; going through the view is what stops the next
        -- one being missed, and it brings crew bans and grants along free.
        select 1 from visible_rooms a
        join visible_rooms b on a.room_id = b.room_id
        where a.user_id = @viewer and b.user_id = @rider
    )
    or exists (
        select 1 from friendships
        where status = 'accepted'
          and ((requester_id = @viewer and addressee_id = @rider)
            or (requester_id = @rider and addressee_id = @viewer))
    )
    or exists (
        -- ADR-0024: a pending request *from* them opens their page, "see who
        -- before you accept", and the case is part of that page (#1654). A
        -- pending ask *to* them is not a door.
        select 1 from friendships
        where status = 'pending' and requester_id = @rider and addressee_id = @viewer
    )
)::boolean;

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
-- This month's totals — friends only (ADR-0024) — in the rider's own zone
-- (#1653): the server's month turned hours before or after theirs.
select count(*)::bigint as rides,
       coalesce(sum(seconds), 0)::bigint as seconds,
       coalesce(sum(kj), 0)::bigint as kj
from rides
where user_id = sqlc.arg(user_id)
  and started_at >= (date_trunc('month', now() at time zone sqlc.arg(tz)::text) at time zone sqlc.arg(tz)::text);

-- name: CountRiderMedalsInCommon :many
-- Medals the rider earned in rooms both may enter (`visible_rooms`), by kind.
-- A room the rider has left, or is banned from at either level, is no longer
-- one they may enter, so its medals drop out.
select m.kind, count(*)::bigint as count
from medals m
join visible_rooms a on a.room_id = m.room_id and a.user_id = sqlc.arg(rider)
join visible_rooms b on b.room_id = m.room_id and b.user_id = sqlc.arg(viewer)
where m.user_id = sqlc.arg(rider)
group by m.kind
order by m.kind;

-- name: ListSharedRides :many
-- The rides the rider marked shared, newest first — friends only. The room
-- is named only when the viewer may enter it (`visible_rooms`, ADR-0038's
-- person-visibility section; ADR-0012: friendship never pierces the room
-- boundary); otherwise the ride just "was in a room".
select r.id, r.workout_name, r.started_at, r.seconds, r.kj, r.execution, r.execution_scored,
       (r.room_id is not null)::boolean as in_room,
       coalesce(case when v.user_id is not null then rm.name end, '')::text as room_name,
       coalesce((select string_agg(m.kind, ' ' order by m.kind) from medals m where m.ride_id = r.id), '')::text as medal_kinds
from rides r
left join rooms rm on rm.id = r.room_id
left join visible_rooms v on v.room_id = r.room_id and v.user_id = sqlc.arg(viewer)
where r.user_id = sqlc.arg(rider) and r.shared_at is not null
order by r.started_at desc
limit sqlc.arg(max);
