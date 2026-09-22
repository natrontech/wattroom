-- A crew's channels (ADR-0058, #2434): text channels and voice channels,
-- furniture under the crew. The crew's owner and admins keep them; who may
-- enter one is `channels.mayEnter`, asked of the rows these return — nothing
-- here decides it.

-- name: ListCrewChannels :many
-- Text before voice, each in its own order — the sidebar's two lists. The id
-- breaks a tie, so two reads agree on the order.
select * from channels
where crew_id = $1
order by kind = 'voice', position, created_at, id;

-- name: GetChannel :one
select * from channels where id = $1;

-- name: NamedChannelsFor :many
-- The crew's private channels that name this rider.
select cm.channel_id
from channel_members cm
join channels c on c.id = cm.channel_id
where c.crew_id = $1 and cm.user_id = $2;

-- name: IsNamedInChannel :one
select exists (select 1 from channel_members where channel_id = $1 and user_id = $2);

-- name: ListChannelMembers :many
-- A private channel's named members, for the channels of one crew.
select cm.channel_id, u.id, u.display_name, u.avatar_url
from channel_members cm
join channels c on c.id = cm.channel_id
join users u on u.id = cm.user_id
where c.crew_id = $1
order by u.display_name, u.id;

-- name: CreateChannel :one
-- Bounded per crew and kind (protocol.MaxCrewTextChannels,
-- MaxCrewVoiceChannels), and the bound is enforced HERE rather than by a
-- read-then-insert in the handler — the CreateCrewPin shape: the count and the
-- insert are one statement, and no row returned is the refusal. A new channel
-- goes to the end of its list.
insert into channels (crew_id, kind, name, position, private)
select @crew_id, @kind, @name,
       coalesce((select max(position) + 1 from channels where crew_id = @crew_id and kind = @kind), 0),
       @private
where (select count(*) from channels where crew_id = @crew_id and kind = @kind) < @max_channels::int
returning *;

-- name: UpdateChannel :one
-- Everything a PATCH may change, written whole: the handler merges the
-- request into the row it read. Position is not here — ReorderChannel owns it.
update channels
set name = @name, private = @private, sound_pack = @sound_pack,
    autoplay_enabled = @autoplay_enabled, autoplay_order = @autoplay_order,
    autoplay_playlist_id = @autoplay_playlist_id
where id = @id
returning *;

-- name: ListChannelIDsOfKind :many
select id from channels
where crew_id = $1 and kind = $2
order by position, created_at, id;

-- name: SetChannelPosition :exec
update channels set position = $2 where id = $1;

-- name: DeleteChannel :exec
-- Takes its chat, its play log and its recaps with it (the cascades on
-- channel_id): the client confirms first (errors.md), because none of that
-- comes back.
delete from channels where id = $1;

-- name: NameChannelMember :exec
insert into channel_members (channel_id, user_id, added_by) values ($1, $2, $3)
on conflict (channel_id, user_id) do nothing;

-- name: UnnameChannelMember :exec
delete from channel_members where channel_id = $1 and user_id = $2;

-- name: IsCrewPlaylist :one
-- A voice channel's autoplay plays one of ITS crew's playlists, never a
-- rider's own or another crew's.
select exists (select 1 from playlists where id = $1 and crew_id = $2);
