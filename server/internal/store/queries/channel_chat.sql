-- A text channel's chat (ADR-0058, #2435): what the room's chat queries were,
-- keyed on the channel.
-- Every statement is scoped by the channel, which is the privacy boundary now:
-- an id from another channel's log is not a line here.

-- name: SaveChannelMessage :one
-- An attached image must be THIS channel's, for the room's reason: a foreign
-- id would pin its bytes past the sweep.
insert into chat_messages (channel_id, user_id, text, image_id, created_at, expires_at)
select @channel_id, @user_id, @text, @image_id, @created_at, sqlc.narg(expires_at)::timestamptz
where @image_id::uuid is null
   or exists (select 1 from chat_images where id = @image_id and channel_id = @channel_id)
returning id;

-- name: SaveChannelImage :one
insert into chat_images (channel_id, user_id, mime, bytes)
values ($1, $2, $3, $4) returning id;

-- name: GetChannelImage :one
select mime, bytes from chat_images
where id = $1 and channel_id = $2;

-- name: ChatImageInChannel :one
select exists(select 1 from chat_images where id = $1 and channel_id = $2)::boolean;

-- name: PruneChannelImages :exec
-- The room's sweep, per channel: an image outlives neither its message nor a
-- 15-minute grace for an upload still awaiting its send.
delete from chat_images i
where i.channel_id = $1
  and i.created_at < now() - interval '15 minutes'
  and not exists (select 1 from chat_messages m where m.image_id = i.id);

-- name: PruneChannelChat :exec
-- The 500-message bound per text channel (docs/SPEC.md), keeping the
-- channel's announcement whatever its age (ADR-0057).
delete from chat_messages cm
where cm.channel_id = $1
  and cm.id is distinct from (select announcement_id from channels where id = $1)
  and cm.id not in (
    select keep.id from (
        select id from chat_messages
        where channel_id = $1
        order by created_at desc
        limit 500
    ) keep
);

-- name: ListChannelChat :many
-- Newest $2, oldest first for rendering; the id breaks a same-millisecond tie.
-- A line whose timer ran out is gone to every reader at once (#2644), not at
-- the next sweep.
select m.id, m.user_id, u.display_name, m.text, m.image_id, m.created_at, m.edited_at, m.expires_at
from (
    select id, user_id, text, image_id, created_at, edited_at, expires_at from chat_messages
    where channel_id = $1
      and (expires_at is null or expires_at > now())
    order by created_at desc, id desc
    limit $2
) m
join users u on u.id = m.user_id
order by m.created_at, m.id;

-- name: GetChannelMessage :one
select user_id, text, image_id from chat_messages
where id = $1 and channel_id = $2
  and (expires_at is null or expires_at > now());

-- name: DeleteExpiredChat :execrows
-- Temporary lines whose timer ran out (#2644), a batch at a time; reactions
-- cascade and a picture is swept with the orphans.
delete from chat_messages
where id in (
    select id from chat_messages
    where expires_at <= now()
    limit 10000
);

-- name: EditChannelMessage :one
-- Only the author, only the text (#865); the scope repeated, not trusted.
update chat_messages
set text = @text, edited_at = now()
where id = @id and channel_id = @channel_id and user_id = @user_id
returning edited_at;

-- name: DeleteChannelMessage :execrows
-- Reactions cascade, the picture is swept on the grace, and an announcement
-- pointing at it is nulled by the FK (#2417).
delete from chat_messages where id = $1 and channel_id = $2;

-- name: ListChannelReactions :many
select r.message_id, r.emoji,
       count(*) as total,
       bool_or(r.user_id = @viewer) as mine
from chat_reactions r
join chat_messages m on m.id = r.message_id
where m.channel_id = @channel_id
group by r.message_id, r.emoji;

-- name: AddChannelReaction :execrows
insert into chat_reactions (message_id, user_id, emoji)
select @message_id, @user_id, @emoji
where exists (select 1 from chat_messages where id = @message_id and channel_id = @channel_id)
on conflict do nothing;

-- name: RemoveChannelReaction :execrows
delete from chat_reactions r
using chat_messages m
where r.message_id = @message_id and r.user_id = @user_id and r.emoji = @emoji
  and m.id = r.message_id and m.channel_id = @channel_id;

-- name: MarkChannelRead :exec
-- The cursor moves to the line the reader was shown, up_to, by that line's
-- own created_at (#2755): a clock stamp also covered whatever landed between
-- the thread's load and this write, and reading no clock at all is what keeps
-- a skewed one from leaving a line unread after the read (#2728). No up_to —
-- a tab on the script from before — means the channel's newest line. Never
-- backwards, so a device with an older view cannot un-read another's read.
-- A channel with no such line gets no row.
insert into channel_reads (channel_id, user_id, read_at)
select @channel_id, @user_id, max(created_at)
from chat_messages
where channel_id = @channel_id
  and (sqlc.narg(up_to)::uuid is null or id = sqlc.narg(up_to))
having max(created_at) is not null
on conflict (channel_id, user_id) do update set read_at = greatest(channel_reads.read_at, excluded.read_at);

-- name: GetChannelReadAt :one
select read_at from channel_reads where channel_id = $1 and user_id = $2;

-- name: SetChannelAnnouncement :execrows
-- One per text channel (ADR-0057 as amended by ADR-0058). The message must be
-- this channel's; 0 rows is the 404.
update channels c set announcement_id = @message_id
where c.id = @channel_id and c.kind = 'text'
  and exists (select 1 from chat_messages m where m.id = @message_id and m.channel_id = @channel_id);

-- name: ClearChannelAnnouncement :exec
update channels set announcement_id = null where id = $1;

-- name: GetChannelAnnouncement :one
-- The author is the message's, not whoever marked it.
select m.id, m.text, u.display_name as from_name, u.id as from_id, m.created_at
from channels c
join chat_messages m on m.id = c.announcement_id
join users u on u.id = m.user_id
where c.id = $1;

-- name: NewestCrewAnnouncement :one
-- What the crew's Board leads with (ADR-0058): the newest announcement across
-- its text channels — of those the viewer may enter, `channels.mayEnter`'s
-- rule restated because it filters rows. The handler has proved the viewer
-- an unbanned member; `admin` is the owner or an admin.
select c.id as channel_id, c.name as channel_name, m.id, m.text, u.display_name as from_name, u.id as from_id, m.created_at
from channels c
join chat_messages m on m.id = c.announcement_id
join users u on u.id = m.user_id
where c.crew_id = @crew_id and c.kind = 'text'
  and (@admin::boolean or not c.private
       or exists (select 1 from channel_members cm where cm.channel_id = c.id and cm.user_id = @viewer))
order by m.created_at desc
limit 1;
