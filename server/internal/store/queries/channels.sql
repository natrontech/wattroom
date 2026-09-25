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

-- name: ChannelAudience :many
-- Who may enter one channel (`visible_channels`): the only riders a ping about
-- its log may reach (#2821) — its activity is part of what its gate keeps.
select user_id from visible_channels where channel_id = $1;

-- name: ListChannelMembers :many
-- A private channel's named members, for the channels of one crew.
select cm.channel_id, u.id, u.display_name, u.avatar_url
from channel_members cm
join channels c on c.id = cm.channel_id
join users u on u.id = cm.user_id
where c.crew_id = $1
order by u.display_name, u.id;

-- name: VoiceChannelsVisibleTo :many
-- Which of these voice channels the viewer may enter, with the crew each
-- belongs to: where a friend is, as the friends panel and a rider's page may
-- say it (#2516). The hub names the channel; this names it only through
-- `visible_channels` — `mayEnter` as one relation, the rule the crew's live
-- read applies — so a channel the viewer may not enter is not in the answer
-- at all. Its name and its crew are part of what its gate keeps (ADR-0012:
-- friendship never pierces the boundary). One query for every channel asked
-- about, however many friends are online (#687).
select c.id as channel_id, c.name as channel_name, cw.id as crew_id, cw.name as crew_name
from channels c
join crews cw on cw.id = c.crew_id
join visible_channels v on v.channel_id = c.id and v.user_id = sqlc.arg(viewer)
where c.id = any(sqlc.arg(channel_ids)::uuid[]) and c.kind = 'voice';

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

-- name: CancelPrivateChannelPlans :many
-- A private channel's plans are its own (#2610), so they go before it does.
-- The foreign key would null them into plans every member and the crew's
-- shared feed can read. An open channel's plans keep their slot on the
-- crew's schedule, with no channel.
delete from scheduled_sessions s
using channels c
where c.id = $1 and c.private and s.channel_id = c.id
returning s.workout_name, s.starts_at, s.started_at;

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

-- name: MovedRoom :one
-- Where an old room link lands now (#2446, #2458): the crew the room became
-- part of and the two channels it became, from the table kept for exactly
-- this (#2558): the rooms themselves are gone (#2433). A channel is named only
-- to a viewer who may enter it (`visible_channels`, #2821): an old link is no
-- key, and a private channel's id is part of what its gate keeps.
select m.crew_id, t.channel_id as text_channel_id, v.channel_id as voice_channel_id
from moved_rooms m
left join visible_channels t on t.channel_id = m.text_channel_id and t.user_id = sqlc.arg(viewer)
left join visible_channels v on v.channel_id = m.voice_channel_id and v.user_id = sqlc.arg(viewer)
where m.slug = sqlc.arg(slug);
