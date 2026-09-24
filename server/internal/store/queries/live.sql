-- What the sidebar reads in one fetch (#2444): the crews a rider is in, with
-- what is happening in each. The channels are the ones the rider may enter —
-- channels.enterable decides that in Go, and these two only ever answer for
-- ids or rows it has already let through, or ask visible_channels itself.

-- name: UnreadByChannel :many
-- Lines from other people since the rider last read each text channel. A
-- channel never read counts its whole bounded log, which is the honest
-- answer: everything in there is new to them (the room's rule, #468).
select m.channel_id, count(*)::int as unread
from chat_messages m
left join channel_reads r on r.channel_id = m.channel_id and r.user_id = sqlc.arg(user_id)
where m.channel_id = any(sqlc.arg(channel_ids)::uuid[])
  and m.user_id <> sqlc.arg(user_id)
  and (r.read_at is null or m.created_at > r.read_at)
  and (m.expires_at is null or m.expires_at > now())
group by m.channel_id;

-- name: NextCrewPlan :one
-- The crew's next plan the rider may see: one for the whole crew, or one in
-- a channel they may enter — a plan in a private channel is that channel's
-- to show. The grace, the started rule and the tiebreak are ListRoomUpcoming's
-- (#1767, #1905), so "next" names the same plan on every read.
select s.id, s.workout_name, s.starts_at, s.channel_id, coalesce(ch.name, '')::text as channel_name
from scheduled_sessions s
left join channels ch on ch.id = s.channel_id
where s.crew_id = sqlc.arg(crew_id)
  and s.starts_at > now() - interval '30 minutes'
  and s.started_at is null
  and (s.channel_id is null
       or exists (select 1 from visible_channels v
                  where v.channel_id = s.channel_id and v.user_id = sqlc.arg(viewer)))
order by s.starts_at, s.created_at, s.id
limit 1;

-- name: LastLineByChannel :many
-- The last thing said in each text channel (#2457), whoever said it: what a
-- crew read announces when the channel has lines the rider has not read,
-- the way a room's lastChat did (#568). Only asked for channels with unread,
-- so a quiet crew costs nothing.
select distinct on (m.channel_id)
       m.channel_id, m.user_id, u.display_name, m.text, m.image_id, m.created_at
from chat_messages m
join users u on u.id = m.user_id
where m.channel_id = any(sqlc.arg(channel_ids)::uuid[])
order by m.channel_id, m.created_at desc;
