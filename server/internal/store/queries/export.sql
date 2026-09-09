-- Export-all (#35, #696). One query per category the law says the export has
-- to carry, each scoped to the requesting account and each returning what the
-- rider can already see in the app — never another rider's health data, ids
-- or contact details. The reasoning for the scope is in the handler.

-- name: ExportUserChat :many
-- The rider's OWN room chat lines. Other people's lines in the same room are
-- their personal data, not the requester's, so they are not here.
select c.text, c.created_at, r.name as room_name, r.slug as room_slug
from chat_messages c
join rooms r on r.id = c.room_id
where c.user_id = $1
order by c.created_at;

-- name: ExportUserDms :many
-- Whole threads, both sides: a DM is as much about the requester as about the
-- peer, and they can already read every line of it in the app. The peer is
-- named the way the app names them and by nothing else.
select m.text, m.created_at, m.sender_id = $1 as sent_by_me,
       (case when m.sender_id = $1 then r.display_name else s.display_name end)::text as peer_name
from dm_messages m
join users s on s.id = m.sender_id
join users r on r.id = m.recipient_id
where m.sender_id = $1 or m.recipient_id = $1
order by m.created_at;

-- name: ExportUserFriends :many
select (case when f.requester_id = $1 then a.display_name else b.display_name end)::text as peer_name,
       f.requester_id = $1 as i_asked, f.status, f.created_at
from friendships f
join users b on b.id = f.requester_id
join users a on a.id = f.addressee_id
where f.requester_id = $1 or f.addressee_id = $1
order by f.created_at;

-- name: ExportUserPlaylists :many
-- Personal playlists only. A room's playlist belongs to the room.
select p.name, p.created_at, coalesce(
    (select json_agg(json_build_object('title', t.title, 'videoId', t.video_id) order by t.position)
     from playlist_tracks t where t.playlist_id = p.id), '[]')::text as tracks
from playlists p
where p.user_id = $1
order by p.created_at;

-- name: ExportUserRsvps :many
select s.workout_name, s.starts_at, r.name as room_name, v.created_at
from session_rsvps v
join scheduled_sessions s on s.id = v.session_id
join rooms r on r.id = s.room_id
where v.user_id = $1
order by s.starts_at;

-- name: ExportUserRooms :many
select r.name, r.slug, m.role, m.joined_at
from memberships m
join rooms r on r.id = m.room_id
where m.user_id = $1
order by m.joined_at;

-- name: ExportUserWorkouts :many
select name, author, definition, created_at from workouts where owner_id = $1 order by created_at;

-- name: ExportUserXp :many
select amount, source, ref, at from xp_events where user_id = $1 order by at;

-- name: ExportUserAchievements :many
select key, earned_at from achievements where user_id = $1 order by earned_at;

-- name: ExportUserMedals :many
-- The rider's own medals (#1550): the room that awarded them, and the ride
-- named by its start so a row lines up with rides.json.
select m.kind, m.awarded_at, rm.name as room_name, r.started_at as ride_started_at
from medals m
join rooms rm on rm.id = m.room_id
join rides r on r.id = m.ride_id
where m.user_id = $1
order by m.awarded_at;

-- name: ExportUserIdentities :many
-- The credential set's provider half (#1826): which provider, the id it knows
-- the rider by, and when it was connected — never a token, sealed or not.
select provider, provider_user_id, created_at
from identities
where user_id = $1
order by created_at;

-- name: ExportUserPasskeys :many
-- The passkeys' public metadata (#1826): the rider's name for each, when it
-- was added and last used — never the credential record itself.
select name, created_at, last_used_at
from passkeys
where user_id = $1
order by created_at;
