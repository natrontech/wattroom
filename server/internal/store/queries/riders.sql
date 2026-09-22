-- A rider's page (ADR-0024): what crew-mates already see, plus what the
-- rider chose to share. Every query here takes the viewer as well as the
-- rider, because the channel boundary decides what comes back.
--
-- That boundary is `visible_channels` and nothing here re-derives it (ADR-0058,
-- carrying ADR-0038's third amendment). The joins used to spell `role !=
-- 'banned'` by hand, which is exactly how #1109 and #1114 happened. The view
-- carries what a hand-written join would have to know: the crew ban, the
-- private gate and who is named into it.

-- name: ListRoomsInCommon :many
-- The rooms whose channels both may enter (`visible_channels`) — what the
-- page lists, not its gate (SharesChannelOrFriends is that). Still rooms,
-- because the page still links to `/r/{slug}`; #2457 names the crew and the
-- channel instead, and a crew made after M9 has no rooms to list here.
select r.id, r.slug, r.name
from rooms r
join room_channels rc on rc.room_id = r.id
where exists (
    select 1 from visible_channels a
    join visible_channels b on b.channel_id = a.channel_id
    where a.channel_id in (rc.text_channel_id, rc.voice_channel_id)
      and a.user_id = sqlc.arg(rider) and b.user_id = sqlc.arg(viewer)
)
order by r.name;

-- name: SharesChannelOrFriends :one
-- ADR-0024's audience for a rider's page, as ONE question (#2298). A channel
-- both may enter (ADR-0058), an accepted friendship, a pending request from them — or the
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
        -- `visible_channels` is the boundary, not a hand-written membership
        -- join (ADR-0058). #1110 fixed this very query for missing `role !=
        -- 'banned'`; going through the view is what stops the next one being
        -- missed, and it brings crew bans and private gates along free.
        select 1 from visible_channels a
        join visible_channels b on a.channel_id = b.channel_id
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

-- name: SharesChannel :one
-- Whether two riders may both enter some channel (`visible_channels`): the
-- friend-request formation gate by id (ADR-0012), which friendship itself
-- must not open.
select exists (
    select 1 from visible_channels a
    join visible_channels b on a.channel_id = b.channel_id
    where a.user_id = @viewer and b.user_id = @rider
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
-- Medals the rider earned in crews where both may enter a channel
-- (`visible_channels`), by kind — a medal belongs to the crew (#2431). A crew
-- the rider has left or been banned from drops out with its medals.
-- ponytail: the room fallback covers medals written before #2443 sets crew_id.
select m.kind, count(*)::bigint as count
from medals m
where m.user_id = sqlc.arg(rider)
  and exists (
      select 1 from channels c
      join visible_channels a on a.channel_id = c.id and a.user_id = sqlc.arg(rider)
      join visible_channels b on b.channel_id = c.id and b.user_id = sqlc.arg(viewer)
      where c.crew_id = coalesce(m.crew_id, (select r.crew_id from rooms r where r.id = m.room_id))
  )
group by m.kind
order by m.kind;

-- name: ListSharedRides :many
-- The rides the rider marked shared, newest first — friends only. The
-- channel is named only when the viewer may enter it (`visible_channels`,
-- ADR-0058; ADR-0012: friendship never pierces the boundary); otherwise the
-- ride just "was in a room". The column names are the page's until #2457.
-- ponytail: the room fallback covers rides written before #2443 sets channel_id.
select r.id, r.workout_name, r.started_at, r.seconds, r.kj, r.execution, r.execution_scored,
       (r.room_id is not null or r.channel_id is not null)::boolean as in_room,
       coalesce(case when v.user_id is not null then ch.name end, '')::text as room_name,
       coalesce((select string_agg(m.kind, ' ' order by m.kind) from medals m where m.ride_id = r.id), '')::text as medal_kinds
from rides r
left join channels ch on ch.id = coalesce(
    r.channel_id, (select rc.voice_channel_id from room_channels rc where rc.room_id = r.room_id))
left join visible_channels v on v.channel_id = ch.id and v.user_id = sqlc.arg(viewer)
where r.user_id = sqlc.arg(rider) and r.shared_at is not null
order by r.started_at desc
limit sqlc.arg(max);
