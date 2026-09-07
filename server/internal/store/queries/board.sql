-- name: SaveBoardClip :one
insert into board_clips (user_id, name, duration_ms, bytes, end_ms)
values ($1, $2, $3, $4, $5)
returning id, created_at;

-- name: ListBoardClips :many
-- The library, newest first. Never selects `bytes` — a listing that carried
-- the audio would be the whole quota in one response.
select id, name, pad, key, duration_ms, octet_length(bytes)::int as size_bytes,
       start_ms, end_ms, gain_db, fade_in_ms, fade_out_ms, created_at
from board_clips
where user_id = $1
order by created_at desc;

-- name: GetBoardClip :one
-- Serving is by clip id alone: a clip is personal, so the authorization is
-- "does the listener share a room with the owner" and only the hub knows it.
select user_id, bytes from board_clips where id = $1;

-- name: BoardClipBytes :one
-- The quota, asked before every upload. Postgres sums the lengths; the bytes
-- themselves never leave the database for this.
select coalesce(sum(octet_length(bytes)), 0)::bigint from board_clips where user_id = $1;

-- name: DeleteBoardClip :execrows
delete from board_clips where id = $1 and user_id = $2;

-- name: SetBoardClipPad :execrows
-- Assign or clear a pad. The unique index makes "the pad is taken" a conflict
-- rather than a race, and the clip that was there is bumped to the library.
update board_clips set pad = $3 where id = $1 and user_id = $2;

-- name: ClearBoardPad :exec
update board_clips set pad = null where user_id = $1 and pad = $2;

-- name: SetBoardClipEdit :execrows
-- The edit is numbers, never a re-encode: the source bytes stay as uploaded.
update board_clips
set start_ms = $3, end_ms = $4, gain_db = $5, fade_in_ms = $6, fade_out_ms = $7
where id = $1 and user_id = $2;

-- name: GetBoardClipSource :one
-- What the edit is validated against: the uploaded file's own length.
select duration_ms from board_clips where id = $1 and user_id = $2;

-- name: SetBoardClipKey :execrows
-- Null clears the binding: a clip with no key is tapped, never fired blind.
update board_clips set key = $3 where id = $1 and user_id = $2;

-- name: ClearBoardKey :exec
-- The key moves rather than colliding, the same way a pad does.
update board_clips set key = null where user_id = $1 and key = $2;
