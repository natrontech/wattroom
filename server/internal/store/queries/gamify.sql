-- name: AddXpEvent :execrows
-- Idempotent on (user, source, ref): a retried save, a replayed webhook or
-- a second tab reporting the same thing cannot pay twice.
insert into xp_events (user_id, source, amount, ref, at)
values ($1, $2, $3, $4, $5)
on conflict (user_id, source, ref) do nothing;

-- name: AddLoungeXp :execrows
-- Five full minutes in voice (docs/SPEC.md XP sources). Pays 1 XP until the
-- day's cap is reached, then records the block at 0 — lounge hours keep
-- counting toward Lounge Lizard after the XP stops.
insert into xp_events (user_id, source, amount, ref, at)
select @user_id, 'lounge',
    case when coalesce((
        select sum(x.amount) from xp_events x
        where x.user_id = @user_id and x.source = 'lounge' and x.at >= @day_start
    ), 0) >= @daily_cap then 0 else 1 end,
    @ref, @happened_at
on conflict (user_id, source, ref) do nothing;

-- name: XpBySource :many
-- What each source paid, and how many rows it left — the trophy case reads
-- the sums, achievements count the rows.
select source, coalesce(sum(amount), 0)::bigint as amount, count(*)::bigint as n
from xp_events
where user_id = $1
group by source;

-- name: ListUserAchievements :many
select key, earned_at from achievements where user_id = $1 order by earned_at;

-- name: AwardAchievement :execrows
insert into achievements (user_id, key, earned_at)
values ($1, $2, $3)
on conflict (user_id, key) do nothing;

-- name: UserRideTally :one
-- The trophy case's ride numbers: how many, how much energy, how much XP.
select count(*)::bigint as rides,
       coalesce(sum(kj), 0)::bigint as kj,
       coalesce(sum(xp), 0)::bigint as xp
from rides where user_id = $1;

-- name: ListUserRideTimes :many
-- Start and length only: Sunrise Club and Night Shift count clock times.
select started_at, seconds from rides
where user_id = $1
order by started_at desc
limit 5000;

-- name: UserMedalTally :many
select kind, count(*)::bigint as n from medals where user_id = $1 group by kind;

-- name: SharesRoomOrFriends :one
-- Who may see another rider's trophy case: someone in one of your rooms, or
-- a friend. The same reach the members list and the friends panel have.
select (
    exists (
        select 1 from memberships a
        join memberships b on a.room_id = b.room_id
        where a.user_id = @viewer and b.user_id = @rider
    )
    or exists (
        select 1 from friendships
        where status = 'accepted'
          and ((requester_id = @viewer and addressee_id = @rider)
            or (requester_id = @rider and addressee_id = @viewer))
    )
)::boolean;
