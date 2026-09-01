-- name: SaveChatMessage :one
-- An attached image must belong to THIS room. Serving already scopes by room,
-- so a foreign id could never be viewed — but referencing one would pin its
-- bytes past the sweep, which is how a client escapes the storage bound.
insert into chat_messages (room_id, user_id, text, image_id)
select $1, $2, $3, $4
where $4::uuid is null
   or exists (select 1 from chat_images where id = $4 and room_id = $1)
returning id;

-- name: SaveChatImage :one
insert into chat_images (room_id, user_id, mime, bytes)
values ($1, $2, $3, $4) returning id;

-- name: GetChatImage :one
-- Room-scoped like reactions: the room is the privacy boundary, an id from
-- another room's chat must 404 here.
select mime, bytes from chat_images
where id = $1 and room_id = $2;

-- name: PruneChatImages :exec
-- Swept alongside PruneChat: an image outlives neither its message (dropped
-- off the 500-line log) nor a 15-minute grace for uploads still awaiting
-- their send.
delete from chat_images i
where i.room_id = $1
  and i.created_at < now() - interval '15 minutes'
  and not exists (
      select 1 from chat_messages m where m.image_id = i.id
  );

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
select m.id, m.user_id, u.display_name, m.text, m.image_id, m.created_at
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

-- name: MarkRoomRead :exec
-- Opening a room is reading it. Upsert so the first visit works the same as
-- the hundredth.
insert into room_reads (room_id, user_id, read_at)
values ($1, $2, now())
on conflict (room_id, user_id) do update set read_at = now();

-- name: CountRoomUnread :one
-- Lines from other people since you last opened the room. A rider who has
-- never opened it sees the whole bounded log, which is the honest answer:
-- everything in there is new to them.
select count(*)
from chat_messages m
left join room_reads r on r.room_id = m.room_id and r.user_id = $2
where m.room_id = $1
  and m.user_id != $2
  and (r.read_at is null or m.created_at > r.read_at);
