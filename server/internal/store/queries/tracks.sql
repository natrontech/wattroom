-- name: CreateTrack :one
-- Content-addressed: a second upload of the same bytes hits the unique index
-- on sha256, and the caller reads the existing row instead of storing a copy.
insert into tracks (sha256, uploaded_by, title, artist, album, duration_ms, size_bytes, bpm)
values ($1, $2, $3, $4, $5, $6, $7, $8)
returning *;

-- name: TrackBySha :one
select * from tracks where sha256 = $1;

-- name: GetTrack :one
select * from tracks where id = $1;

-- name: ListTracks :many
-- The pool: one global library every signed-in rider browses (ADR-0015),
-- newest first. Carries the uploader's name so a track has a face.
--
-- An empty search returns everything: the browse view and the search view are
-- one query, so a rider clearing the box gets the library back rather than a
-- second code path that might disagree with the first.
select t.*, u.display_name as uploaded_by_name
from tracks t
join users u on u.id = t.uploaded_by
where sqlc.arg(search)::text = ''
   or t.search @@ websearch_to_tsquery('simple', sqlc.arg(search)::text)
order by
    -- Ranked when there is a query, newest when there is not.
    case when sqlc.arg(search)::text = '' then 0
         else ts_rank(t.search, websearch_to_tsquery('simple', sqlc.arg(search)::text))
    end desc,
    t.created_at desc
limit sqlc.arg(lim) offset sqlc.arg(off);

-- name: TrackQuotaUsed :one
-- What this rider's uploads take up. Summed over their own rows, which is
-- exact because a deduped upload never created one.
select coalesce(sum(size_bytes), 0)::bigint from tracks where uploaded_by = $1;

-- name: UpdateTrack :one
-- Every field editable in place: real-world tags are garbage and
-- edit-beats-cleanup (ADR-0015). Uploader only — the where clause is the check.
update tracks set title = $3, artist = $4, album = $5, bpm = $6
where id = $1 and uploaded_by = $2
returning *;

-- name: DeleteTrack :one
-- Returns the sha so the caller can remove the file it addressed. Uploader
-- only; a row that is not yours simply does not match.
delete from tracks where id = $1 and uploaded_by = $2 returning sha256;
