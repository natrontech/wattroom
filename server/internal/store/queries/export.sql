-- Export-all (#35, #696). One query per category the law says the export has
-- to carry, each scoped to the requesting account and each returning what the
-- rider can already see in the app — never another rider's health data, ids
-- or contact details. The reasoning for the scope is in the handler.

-- name: ExportUserChat :many
-- The rider's OWN room chat lines. Other people's lines in the same room are
-- their personal data, not the requester's, so they are not here.
--
-- The edit and the picture come too (#2089): messages.json has carried both
-- for DMs since #1819 and chat.json carried neither, so an edited line
-- exported as if it had always read that way and a picture-only line exported
-- as an empty string.
select c.text, c.created_at, c.edited_at, c.image_id,
       r.name as room_name, r.slug as room_slug
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
-- The rooms the rider belongs to, and the two choices they made in each
-- (#2089): whether the room may mail them about a planned session, and
-- whether they appear on its weekly board. Both are set on the room's own
-- settings screen and neither was exported.
select r.name, r.slug, m.role, m.joined_at, m.notify, m.on_board
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

-- Everything below was found by the sweep in #2089: every table with a column
-- referencing users(id), read against the categories above. Each is on a
-- screen the rider already has, so each is inside the Art. 15 scope the
-- handler sets out, and each was missing.
--
-- All of them are bounded by the handler's one row ceiling, because none of
-- them is bounded by anything else a rider cannot raise on purpose. The
-- manifest says when a bound bit; a category that goes short in silence is
-- the failure this whole route exists to prevent.

-- name: ExportUserApiTokens :many
-- The coach-access tokens the rider minted (#2089, ADR-0017): the name they
-- gave each, when it was made and when it was last used — the three columns
-- Settings → Data lists. NEVER token_hash: the token itself was shown once at
-- creation and we have only its hash, so there is nothing here to hand back
-- even if it were wise to.
select name, created_at, last_used_at
from api_tokens
where user_id = sqlc.arg(user_id)
order by created_at desc
limit sqlc.arg(lim)::int;

-- The rider's own emoji reactions (#2089), asked of the two surfaces
-- separately and written to one file: adding an emoji to something someone
-- wrote is one act, and the reader should not have to open two files to find
-- theirs. Two queries because sqlc cannot type a parameter comparison inside
-- a UNION arm's select list, and the `mine` flag below is exactly that.
--
-- A reaction is theirs; the line under it may not be. So a row locates the
-- line by the moment it was written, so it lines up with chat.json or
-- messages.json, and the TEXT comes along only where the rider is entitled to
-- it: their own room-chat line, or any line of a DM thread they can already
-- read whole. Someone else's room-chat line is their personal data — the rule
-- chat.json has followed since #696.

-- name: ExportUserChatReactions :many
select r.emoji,
       m.created_at                            as line_at,
       rm.name                                 as room_name,
       rm.slug                                 as room_slug,
       (m.user_id = sqlc.arg(user_id))::boolean as on_my_own_line,
       (case when m.user_id = sqlc.arg(user_id) then m.text else '' end)::text as line
from chat_reactions r
join chat_messages m on m.id = r.message_id
join rooms rm on rm.id = m.room_id
where r.user_id = sqlc.arg(user_id)
order by m.created_at
limit sqlc.arg(lim)::int;

-- name: ExportUserDmReactions :many
-- The whole line comes along here: a DM thread is as much the rider's as the
-- peer's and messages.json already carries every line of it.
select r.emoji,
       m.created_at as line_at,
       (case when m.sender_id = sqlc.arg(user_id) then rp.display_name
             else sp.display_name end)::text     as peer_name,
       (m.sender_id = sqlc.arg(user_id))::boolean as on_my_own_line,
       m.text                                    as line
from dm_reactions r
join dm_messages m on m.id = r.message_id
join users sp on sp.id = m.sender_id
join users rp on rp.id = m.recipient_id
where r.user_id = sqlc.arg(user_id)
order by m.created_at
limit sqlc.arg(lim)::int;

-- name: ExportUserCrews :many
-- The rider's standing in every crew, and the crews they own (#2089, ADR-0038).
-- One file because they are one object seen from two sides: an owner holds no
-- crew_roles row at all (the 2026-09-08 amendment), so the union is the only
-- reading that misses neither.
--
-- `banned` is a standing too, and it is the one a rider is most likely to ask
-- about — so this query filters no role, unlike ListCrewsFor which feeds a
-- sidebar. The join code is the crew's door and every member already reads it
-- in the app; it is a live secret, which is what the privacy page now says
-- about this zip.
select c.name,
       c.icon,
       coalesce(c.code, '')::text                              as join_code,
       c.created_at,
       c.renamed_at,
       (c.owner_id = sqlc.arg(user_id))                        as i_own_it,
       coalesce(c.founded_by = sqlc.arg(user_id), false)::boolean as i_founded_it,
       coalesce(cr.role, case when c.owner_id = sqlc.arg(user_id)
                              then 'owner' else '' end)::text  as my_role,
       cr.joined_at,
       cr.set_at                                               as role_set_at
from crews c
left join crew_roles cr on cr.crew_id = c.id and cr.user_id = sqlc.arg(user_id)
where c.owner_id = sqlc.arg(user_id) or cr.user_id is not null
order by c.created_at
limit sqlc.arg(lim)::int;

-- name: ExportUserScheduledSessions :many
-- The sessions the rider PUT ON the calendar (#2089), which is not the same
-- set as planned-sessions.json: that one is their RSVPs, so a coach who
-- schedules every week and never says yes to their own session exported
-- nothing at all. The workout goes with it — they wrote it into the plan, and
-- it is what the room was asked to ride.
select s.workout_name, s.workout_json, s.starts_at, s.created_at, s.started_at,
       r.name as room_name, r.slug as room_slug
from scheduled_sessions s
join rooms r on r.id = s.room_id
where s.created_by = sqlc.arg(user_id)
order by s.starts_at desc
limit sqlc.arg(lim)::int;

-- name: ExportUserOwnedRooms :many
-- The room rows the rider owns (#2089). rooms.json says they are a member;
-- this says what they configured, which is the whole of the room settings
-- screen — including the calendar token, a live link into the room's schedule
-- that no other file carries, and the sound pack, which is a room's setting
-- and not (as #2089 supposed) a column on users.
select r.name, r.slug, r.created_at, r.listed, r.crew_visible, r.board_enabled,
       r.sound_pack, r.icon, r.cheers, r.autoplay_enabled, r.autoplay_order,
       r.ics_token, c.name as crew_name
from rooms r
left join crews c on c.id = r.crew_id
where r.owner_id = sqlc.arg(user_id)
order by r.created_at
limit sqlc.arg(lim)::int;

-- name: ExportUserRoomDoors :many
-- Named exceptions into a private room (#2089, ADR-0038 #1224): a door, not a
-- membership — the person still walks in themselves, and the grant is moot
-- once they do.
--
-- Both directions, because both are the rider's: the doors opened FOR them,
-- and the doors THEY opened as a room's owner. The second names other people,
-- so it names them the way the owner's own door list does and by nothing
-- else — a display name, never an id or an address.
select 'toMe'::text as direction, r.name as room_name, r.slug as room_slug,
       ''::text as rider, g.granted_at
from room_grants g
join rooms r on r.id = g.room_id
where g.user_id = sqlc.arg(user_id)
union all
select 'iOpened'::text, r.name, r.slug, u.display_name::text, g.granted_at
from room_grants g
join rooms r on r.id = g.room_id
join users u on u.id = g.user_id
where r.owner_id = sqlc.arg(user_id) and g.user_id <> sqlc.arg(user_id)
order by granted_at
limit sqlc.arg(lim)::int;

-- name: ExportUserBoardClips :many
-- The soundboard the rider built (#2089): every clip in their library, the
-- name they typed, the pad and key they bound it to, and the edit they set —
-- the same columns ListBoardClips renders, which is what they see.
--
-- Rows in, AUDIO OUT, the reading ADR-0015 settled for uploaded music and
-- #2081 applied to tracks.json: "metadata is; files are re-uploadable". It is
-- also the only version that fits — a rider's clips may be 100 MB (SPEC's
-- MaxRiderBytes) and this archive is built whole in memory. The clip's id
-- comes along because a clip is served by id and nothing else, so a row still
-- names its file. The bytes a rider uploaded are #2090.
select id, name, pad, key, duration_ms, octet_length(bytes)::int as size_bytes,
       start_ms, end_ms, gain_db, fade_in_ms, fade_out_ms, created_at
from board_clips
where user_id = sqlc.arg(user_id)
order by created_at desc
limit sqlc.arg(lim)::int;

-- name: ExportUserRideDeliveries :many
-- Where each ride was sent and whether it arrived (#2089, #799): the ride
-- page says "On Strava as …", or waiting, or failed, and none of it was in
-- the archive. Owner-scoped through rides, because ride_exports keys on the
-- ride and not on the rider.
--
-- The ride is named by its start, the way medals.json names one, so a row
-- lines up with rides.json without a uuid meaning anything outside this
-- database.
select e.destination, e.state, e.attempts, e.last_error, e.remote_id,
       e.created_at, e.updated_at,
       r.started_at as ride_started_at, r.workout_name
from ride_exports e
join rides r on r.id = e.ride_id
where r.user_id = sqlc.arg(user_id)
order by r.started_at desc
limit sqlc.arg(lim)::int;
