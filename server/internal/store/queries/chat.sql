-- name: SaveChatMessage :one
insert into chat_messages (room_id, user_id, text)
values ($1, $2, $3) returning id;

-- name: PruneChat :exec
-- The 500-message bound (ADR-0010 amended) — run on write, the log never grows.
delete from chat_messages cm
where cm.room_id = $1 and cm.id not in (
    select keep.id from (
        select id from chat_messages
        where room_id = $1
        order by created_at desc
        limit 500
    ) keep
);

-- name: ListRoomChat :many
-- Newest $2, oldest-first for rendering; a deleted author's rows are gone
-- (cascade), so the join never dangles.
select m.id, m.user_id, u.display_name, m.text, m.created_at
from (
    select * from chat_messages
    where room_id = $1
    order by created_at desc
    limit $2
) m
join users u on u.id = m.user_id
order by m.created_at;

-- name: ListChatReactions :many
-- Counts per message+emoji for the backlog, plus whether the viewer is in.
select r.message_id, r.emoji,
       count(*) as total,
       bool_or(r.user_id = $2) as mine
from chat_reactions r
join chat_messages m on m.id = r.message_id
where m.room_id = $1
group by r.message_id, r.emoji;

-- name: AddChatReaction :execrows
-- Toggle half 1: no-op when already reacted (the conflict), so the caller
-- knows to remove instead.
insert into chat_reactions (message_id, user_id, emoji)
select $1, $2, $3
where exists (select 1 from chat_messages where id = $1 and room_id = $4)
on conflict do nothing;

-- name: RemoveChatReaction :execrows
-- Room-scoped like the insert — a socket in room A must not toggle
-- reactions on room B's messages (audit #219).
delete from chat_reactions r
using chat_messages m
where r.message_id = $1 and r.user_id = $2 and r.emoji = $3
  and m.id = r.message_id and m.room_id = $4;

-- name: CountChatReaction :one
select count(*) from chat_reactions where message_id = $1 and emoji = $2;
