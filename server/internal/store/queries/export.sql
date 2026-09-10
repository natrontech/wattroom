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
select m.text, m.created_at, m.edited_at, m.image_id, m.sender_id = $1 as sent_by_me,
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
--
-- An entry is what a JukeboxEntry is (ADR-0045): a video, a pasted YouTube
-- playlist, or a track from the rider's own library. Exporting only
-- `video_id` made the last two unreadable (#1089) — a library entry has no
-- video id at all, so a playlist of the rider's own uploads exported as a
-- list of blanks, and a pasted playlist lost its name and its resolved
-- videos. `source` says which of the three an entry is, so nothing has to be
-- inferred from an empty string; the track is named rather than pointed at,
-- because a uuid means nothing outside this database.
select p.name, p.created_at, coalesce(
    (select json_agg(json_build_object(
        'source', case when t.track_id is not null then 'library'
                       when t.yt_playlist_id <> '' then 'youtubePlaylist'
                       else 'video' end,
        'title', t.title,
        'videoId', nullif(t.video_id, ''),
        'startSec', t.start_sec,
        'youtubePlaylistTitle', nullif(t.yt_playlist_title, ''),
        'videos', case when t.yt_playlist_id <> '' then t.tracks else null end
     ) order by t.position)
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

-- name: ExportUserTracks :many
-- The music the rider uploaded (#1089): their own shelf's rows, which since
-- #1095 is exactly what they can see in the pool — every field they typed,
-- plus what the file itself measured. The AUDIO is not here and must not be:
-- ADR-0015's copyright fence has no public share links to audio files, and
-- the ADR already settled the same question for backups ("metadata is; files
-- are re-uploadable"). The content address is, so a row still names its file.
--
-- Bounded, unlike the categories above: ADR-0015's quota is 2 GB per rider
-- and nothing bounds how small an MP3 may be, so the row count is the one
-- here that a rider can run up on purpose. The handler says what the bound
-- is and the manifest says when it bit.
--
-- Newest first under that bound, the order the shelf itself is browsed in —
-- ascending with a limit would drop the tracks they just uploaded.
select sha256, title, artist, album, tags, bpm, duration_ms, size_bytes, created_at
from tracks
where uploaded_by = $1
order by created_at desc
limit sqlc.arg(lim)::int;
