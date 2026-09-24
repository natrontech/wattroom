-- Export-all (#35, #696). One query per category the law says the export has
-- to carry, each scoped to the requesting account and each returning what the
-- rider can already see in the app — never another rider's health data, ids
-- or contact details. The reasoning for the scope is in the handler.

-- name: ExportUserChat :many
-- The rider's OWN chat lines. Other people's lines in the same channel are
-- their personal data, not the requester's, so they are not here.
--
-- Placed by the text channel and its crew (#2554, #2558): a line written
-- since M9 has no room, and an inner join on `rooms` once dropped every one of
-- them from the archive.
--
-- The edit and the picture come too (#2089): messages.json has carried both
-- for DMs since #1819 and chat.json carried neither, so an edited line
-- exported as if it had always read that way and a picture-only line exported
-- as an empty string.
select c.text, c.created_at, c.edited_at, c.image_id,
       coalesce(cw.name, '')::text as crew_name, coalesce(ch.name, '')::text as channel_name
from chat_messages c
left join channels ch on ch.id = c.channel_id
left join crews cw on cw.id = ch.crew_id
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
-- The answer comes with it (#1011): a decline lives in this table too, and
-- exporting one as "said yes" would be the export telling the rider
-- something they never said.
--
-- Placed by the crew and the voice channel the plan names, if it names one
-- (#2554): a plan made on a crew's Schedule has no room.
select s.workout_name, s.starts_at, v.created_at, v.going,
       coalesce(cw.name, '')::text as crew_name, coalesce(ch.name, '')::text as channel_name
from session_rsvps v
join scheduled_sessions s on s.id = v.session_id
left join channels ch on ch.id = s.channel_id
left join crews cw on cw.id = s.crew_id
where v.user_id = $1
order by s.starts_at;

-- name: ExportUserWorkouts :many
select name, author, definition, created_at from workouts where owner_id = $1 order by created_at;

-- name: ExportUserXp :many
select amount, source, ref, at from xp_events where user_id = $1 order by at;

-- name: ExportUserAchievements :many
select key, earned_at from achievements where user_id = $1 order by earned_at;

-- name: ExportUserMedals :many
-- The rider's own medals (#1550): the crew that awarded them (#2443), and
-- the ride named by its start so a row lines up with rides.json.
select m.kind, m.awarded_at, coalesce(c.name, '')::text as crew_name,
       r.started_at as ride_started_at
from medals m
left join crews c on c.id = m.crew_id
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
-- Placed like ExportUserChat, and for its reason (#2554).
select r.emoji,
       m.created_at                            as line_at,
       coalesce(cw.name, '')::text as crew_name, coalesce(ch.name, '')::text as channel_name,
       (m.user_id = sqlc.arg(user_id))::boolean as on_my_own_line,
       (case when m.user_id = sqlc.arg(user_id) then m.text else '' end)::text as line
from chat_reactions r
join chat_messages m on m.id = r.message_id
left join channels ch on ch.id = m.channel_id
left join crews cw on cw.id = ch.crew_id
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
       -- Owner first: an owner who set their switches holds a member row too
       -- (SetCrewPrefs), and owner beats it wherever a role is read.
       (case when c.owner_id = sqlc.arg(user_id) then 'owner'
             else coalesce(cr.role, '') end)::text             as my_role,
       cr.joined_at,
       cr.set_at                                               as role_set_at,
       -- Their two switches on the membership (#2432, #2554), read the way
       -- GetCrewPrefs reads them: no row is the default, never a guess.
       coalesce(cr.notify, true)::boolean                      as notify,
       coalesce(cr.on_board, false)::boolean                   as on_board
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
--
-- Placed like ExportUserRsvps (#2554).
select s.workout_name, s.workout_json, s.starts_at, s.created_at, s.started_at,
       coalesce(cw.name, '')::text as crew_name, coalesce(ch.name, '')::text as channel_name
from scheduled_sessions s
left join channels ch on ch.id = s.channel_id
left join crews cw on cw.id = s.crew_id
where s.created_by = sqlc.arg(user_id)
order by s.starts_at desc
limit sqlc.arg(lim)::int;

-- name: ExportUserChannelMembers :many
-- Being named into a private channel (ADR-0058, #2554): the successor of
-- ExportUserRoomDoors, and both directions for its reason. The channels that
-- name the rider, and the people the rider named into one — by display name,
-- never an id or an address.
select 'toMe'::text as direction, cw.name as crew_name, c.name as channel_name, c.kind,
       ''::text as rider, cm.added_at
from channel_members cm
join channels c on c.id = cm.channel_id
join crews cw on cw.id = c.crew_id
where cm.user_id = sqlc.arg(user_id)
union all
select 'iNamed'::text, cw.name, c.name, c.kind, u.display_name::text, cm.added_at
from channel_members cm
join channels c on c.id = cm.channel_id
join crews cw on cw.id = c.crew_id
join users u on u.id = cm.user_id
where cm.added_by = sqlc.arg(user_id) and cm.user_id <> sqlc.arg(user_id)
order by added_at
limit sqlc.arg(lim)::int;

-- name: ExportUserBoardClips :many
-- The soundboard the rider built (#2089): every clip in their library, the
-- name they typed, the pad and key they bound it to, and the edit they set —
-- the same columns ListBoardClips renders, which is what they see.
--
-- Rows here, audio in uploads/soundboard/ (#2090, ADR-0053): ADR-0015's
-- "metadata is; files are re-uploadable" is about somebody else's recording
-- and has nothing to say about a clip the rider trimmed themselves. This
-- query still never selects `bytes` — the export writes them one clip at a
-- time, because a rider may hold 100 MB of them (SPEC's MaxRiderBytes) and
-- the archive is built whole in memory. The id comes along because it names
-- the file: a clip is served by id and nothing else.
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

-- name: ExportUserChatImages :many
-- The pictures the rider pasted into a text channel (#2090), placed like
-- ExportUserChat (#2554). chat.json carries the
-- image id on the line it was sent with and nothing resolved it, so the
-- archive named a file it did not describe and did not contain.
--
-- Not `bytes`: the row says how big the picture is and images.json says why
-- the bytes are not here. A rider's pictures have no per-rider ceiling the way
-- their clips do (SPEC's MaxRiderBytes), and this archive is built whole in
-- memory (#1990).
--
-- Left join on the message: an image whose line was deleted still belongs to
-- the rider who uploaded it, and `chat_messages.image_id` goes null rather
-- than taking the row with it.
select i.id, i.mime, octet_length(i.bytes)::int as size_bytes, i.created_at,
       coalesce(cw.name, '')::text as crew_name, coalesce(ch.name, '')::text as channel_name,
       (m.id is not null)::boolean as still_on_a_line
from chat_images i
left join channels ch on ch.id = i.channel_id
left join crews cw on cw.id = ch.crew_id
left join chat_messages m on m.image_id = i.id
where i.user_id = sqlc.arg(user_id)
order by i.created_at desc
limit sqlc.arg(lim)::int;

-- name: ExportUserDmImages :many
-- The pictures the rider SENT in a direct message (#2090, #1819) — the ones
-- they uploaded. A picture a peer sent them is the peer's upload; the line it
-- came on is already whole in messages.json.
--
-- Same shape and same reason as ExportUserChatImages above: metadata, not
-- bytes.
select i.id, i.mime, octet_length(i.bytes)::int as size_bytes, i.created_at,
       u.display_name as peer_name,
       (m.id is not null)::boolean as still_on_a_line
from dm_images i
join users u on u.id = i.recipient_id
left join dm_messages m on m.image_id = i.id
where i.sender_id = sqlc.arg(user_id)
order by i.created_at desc
limit sqlc.arg(lim)::int;

-- name: ExportUserCrewEmoji :many
-- The emoji the rider added to a crew (#2643): their upload, the way a pasted
-- picture is, and gone with the account the same way. The crew's id and the
-- emoji's together name the file — it is served at
-- /api/crews/{crew}/emoji/{id} — and the crew's name says which crew it is.
--
-- Not `bytes`, for images.json's reason (ADR-0053): each picture is bounded
-- but how many crews a rider is in is not, so the total a rider holds has no
-- ceiling, and this archive is built whole in memory (#1990).
select e.id, e.name, e.mime, octet_length(e.bytes)::int as size_bytes, e.created_at,
       e.crew_id, c.name as crew_name
from crew_emoji e
join crews c on c.id = e.crew_id
where e.user_id = sqlc.arg(user_id)
order by e.created_at desc
limit sqlc.arg(lim)::int;
