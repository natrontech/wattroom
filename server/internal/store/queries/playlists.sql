-- name: CreatePlaylist :one
insert into playlists (room_id, user_id, name)
values ($1, $2, $3)
returning *;

-- name: ListRoomPlaylists :many
select p.*, count(t.id) as track_count
from playlists p left join playlist_tracks t on t.playlist_id = p.id
where p.room_id = $1
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
select * from playlist_tracks where playlist_id = $1 order by position;

-- name: NextTrackPosition :one
select coalesce(max(position), -1) + 1 from playlist_tracks where playlist_id = $1;

-- name: InsertPlaylistTrack :one
insert into playlist_tracks
    (playlist_id, position, video_id, title, start_sec, yt_playlist_id, yt_playlist_title, tracks)
values ($1, $2, $3, $4, $5, $6, $7, $8)
returning *;

-- name: DeletePlaylistTrack :execrows
delete from playlist_tracks where id = $1 and playlist_id = $2;

-- name: SetActivePlaylist :execrows
-- The exists() check enforces "active must be one of this room's own
-- playlists" in one round trip rather than a second SELECT the caller could
-- forget — same shape as UpdateWorkout's ownership WHERE clause.
update rooms r set autoplay_playlist_id = $2
where r.id = $1 and exists (select 1 from playlists p where p.id = $2 and p.room_id = r.id);

-- name: ClearActivePlaylist :exec
update rooms set autoplay_playlist_id = null where id = $1;

-- name: UpdateAutoplay :one
update rooms set autoplay_enabled = $2, autoplay_order = $3,
    autoplay_fixed_video_id = $4, autoplay_fixed_video_title = $5
where id = $1 returning *;
