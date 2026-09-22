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

-- The rooms bridge (#2436): the hub keys by voice channel, and what still
-- speaks in rooms — the rooms package, and the keepers that write room_id —
-- crosses here until its own M9 issue re-keys it. Every one of these goes
-- with `room_channels` (#2433).

-- name: VoiceChannelOfRoom :one
select voice_channel_id from room_channels where room_id = $1;

-- name: RoomOfVoiceChannel :one
select r.* from rooms r
join room_channels rc on rc.room_id = r.id
where rc.voice_channel_id = $1;

-- name: RoomSlugsOfVoiceChannels :many
select rc.voice_channel_id, r.slug from room_channels rc
join rooms r on r.id = rc.room_id
where rc.voice_channel_id = any(@ids::uuid[]);

-- name: AdoptRoomChannels :exec
-- A room made after 20260922185319 gets the text and voice channel that
-- migration gave every room before it — the same statement, narrowed to one
-- room. Without them the hub, which keys by voice channel, has nowhere to
-- put it.
with src as (
    select
        r.id              as room_id,
        gen_random_uuid() as text_channel_id,
        gen_random_uuid() as voice_channel_id,
        r.crew_id,
        left(coalesce(nullif(btrim(r.name), ''), 'general'), 60) as name,
        not r.crew_visible as private,
        r.sound_pack,
        r.created_at,
        coalesce((select max(c.position) + 1 from channels c where c.crew_id = r.crew_id), 0)::integer as position
    from rooms r
    where r.id = @room_id and r.crew_id is not null
      and not exists (select 1 from room_channels rc where rc.room_id = r.id)
),
text_channels as (
    insert into channels (id, crew_id, kind, name, position, private, sound_pack, created_at)
    select text_channel_id, crew_id, 'text', name, position, private, 'base', created_at from src
),
voice_channels as (
    insert into channels (id, crew_id, kind, name, position, private, sound_pack, created_at)
    select voice_channel_id, crew_id, 'voice', name, position, private, sound_pack, created_at from src
)
insert into room_channels (room_id, text_channel_id, voice_channel_id)
select room_id, text_channel_id, voice_channel_id from src;

-- name: MovedRoom :one
-- Where an old room link lands now (#2446, #2458): the crew the room became
-- part of and the two channels it became. Only while room_channels is there
-- (#2433 drops it one release after M9).
select r.crew_id, rc.text_channel_id, rc.voice_channel_id
from rooms r
join room_channels rc on rc.room_id = r.id
where r.slug = $1;
