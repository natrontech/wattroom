-- name: PruneOrphanChatImages :execrows
-- A picture uploaded and never sent, swept on the clock rather than on a
-- write (audit 2026-09-09; the #1153 rule): an upload abandoned in a channel
-- that then went quiet was never swept, and its blob sat in Postgres for good.
delete from chat_images i
 where i.ctid in (select ctid from chat_images x
                   where x.created_at < now() - interval '15 minutes'
                     and not exists (select 1 from chat_messages m where m.image_id = x.id)
                   limit 10000);

-- name: CountChatReaction :one
-- The toggle's answer, counted as the list counts it for this viewer (#3202).
select count(*) from chat_reactions
where message_id = @message_id and emoji = @emoji and not rider_hidden(user_id, @viewer);
