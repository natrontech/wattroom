-- name: CreatePlaylist :one
-- A rider's, or a crew's (ADR-0058, #2439). A room's shelf carries its crew
-- as well until the room goes (#2446), so the crew's list shows it too.
insert into playlists (room_id, user_id, crew_id, name)
values ($1, $2, $3, $4)
returning *;

-- name: ListCrewPlaylists :many
-- The crew's shelf (ADR-0058): every playlist the crew keeps, whichever room
-- it was saved in before the rooms went.
select p.*, count(t.id) as track_count
from playlists p left join playlist_tracks t on t.playlist_id = p.id
where p.crew_id = $1
group by p.id order by p.created_at;

-- name: ListUserPlaylists :many
select p.*, count(t.id) as track_count
from playlists p left join playlist_tracks t on t.playlist_id = p.id
where p.user_id = $1
group by p.id order by p.created_at;

-- name: GetPlaylist :one
select * from playlists where id = $1;

-- name: RenamePlaylist :one
update playlists set name = $2, updated_at = now() where id = $1 returning *;

-- name: DeletePlaylist :execrows
delete from playlists where id = $1;

-- name: ListPlaylistTracks :many
-- A library entry reads its title and artist off the track itself (#1426):
-- both are editable on the Music page, and a playlist should say what the
-- library says today, not what it said when the row was saved.
select pt.*, coalesce(t.title, '')::text as track_title, coalesce(t.artist, '')::text as track_artist,
    coalesce(t.bpm, 0)::int as track_bpm,
    coalesce(t.duration_ms, 0)::int as track_duration_ms
from playlist_tracks pt
left join tracks t on t.id = pt.track_id
where pt.playlist_id = $1 order by pt.position;

-- name: NextTrackPosition :one
select coalesce(max(position), -1) + 1 from playlist_tracks where playlist_id = $1;

-- name: InsertPlaylistTrack :one
insert into playlist_tracks
    (playlist_id, position, video_id, title, start_sec, yt_playlist_id, yt_playlist_title, tracks, track_id)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
returning *;

-- name: DeletePlaylistTrack :execrows
delete from playlist_tracks where id = $1 and playlist_id = $2;

-- Reorder (#1428) renumbers every row of one playlist inside a transaction:
-- positions are unique per playlist, so they are first moved out of the way
-- and then written back in the new order.
-- name: ShiftPlaylistPositions :exec
update playlist_tracks set position = position + 1000000 where playlist_id = $1;

-- name: SetPlaylistTrackPosition :exec
update playlist_tracks set position = $3 where id = $1 and playlist_id = $2;

