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
