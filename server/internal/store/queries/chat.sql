-- name: SaveChatMessage :one
-- An attached image must belong to THIS room. Serving already scopes by room,
-- so a foreign id could never be viewed — but referencing one would pin its
-- bytes past the sweep, which is how a client escapes the storage bound.
--
-- created_at is the caller's, not the column's default (#2421): the hub
-- stamps a line the instant it broadcasts it and saves on a worker after,
-- so a row that timed itself timed a different moment — and the two numbers
-- named the same line to the two paths that announce it, which is how one
-- message made two sounds.
insert into chat_messages (room_id, user_id, text, image_id, created_at)
select $1, $2, $3, $4, $5
where $4::uuid is null
   or exists (select 1 from chat_images where id = $4 and room_id = $1)
returning id;

-- name: SaveChatImage :one
insert into chat_images (room_id, user_id, mime, bytes)
values ($1, $2, $3, $4) returning id;

-- name: PruneOrphanChatImages :execrows
-- The same grace as above, on the clock rather than on a write (audit
-- 2026-09-09; the #1153 rule): an upload abandoned in a room that then went
-- quiet was never swept, and its blob sat in Postgres for good.
delete from chat_images i
 where i.ctid in (select ctid from chat_images x
                   where x.created_at < now() - interval '15 minutes'
                     and not exists (select 1 from chat_messages m where m.image_id = x.id)
                   limit 10000);

-- name: EditChatMessage :one
-- Only the author, and only the text (#865). The room scope is repeated here
-- rather than trusted from the read above: two statements, and nothing says
-- the row is still in this room by the time the second one runs.
update chat_messages
set text = $3, edited_at = now()
where id = $1 and room_id = $2 and user_id = $4
returning edited_at;

-- name: AddChatReaction :execrows
-- Toggle half 1: no-op when already reacted (the conflict), so the caller
-- knows to remove instead.
insert into chat_reactions (message_id, user_id, emoji)
select $1, $2, $3
where exists (select 1 from chat_messages where id = $1 and room_id = $4)
on conflict do nothing;

-- name: CountChatReaction :one
select count(*) from chat_reactions where message_id = $1 and emoji = $2;
