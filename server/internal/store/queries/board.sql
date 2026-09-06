-- name: SaveBoardClip :one
insert into board_clips (user_id, name, duration_ms, bytes)
values ($1, $2, $3, $4)
returning id, created_at;

-- name: ListBoardClips :many
-- The library, newest first. Never selects `bytes` — a listing that carried
-- the audio would be the whole quota in one response.
select id, name, pad, duration_ms, octet_length(bytes)::int as size_bytes, created_at
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
