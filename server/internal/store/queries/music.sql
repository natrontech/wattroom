-- name: ListTracks :many
-- The pool, newest first. One global pool per instance (ADR-0015): everybody
-- browses all of it. Search and facets are #268's job.
select * from tracks order by created_at desc limit $1;

-- name: GetTrack :one
select * from tracks where id = $1;

-- name: GetTrackBySha :one
-- The dedupe probe: this exact file may already be in the pool, uploaded by
-- anyone.
select * from tracks where sha256 = $1;

-- name: CreateTrack :one
-- The quota lives in the insert as well as at the boundary. The boundary check
-- is what gives the rider a useful message; this one is what stays true when
-- two uploads race, since the sum and the insert share a statement.
-- No row back means either the quota was blown or this sha is already in the
-- pool — the caller re-probes by sha to tell those apart.
insert into tracks (
    sha256, uploader_id, size_bytes, duration_sec, title, artist, album, tags, year, bpm
)
select
    @sha256, @uploader_id, @size_bytes, @duration_sec,
    @title, @artist, @album, @tags::text[], sqlc.narg('year')::int, sqlc.narg('bpm')::int
where (
    select coalesce(sum(t.size_bytes), 0) from tracks t where t.uploader_id = @uploader_id
) + @size_bytes <= @quota_bytes
on conflict (sha256) do nothing
returning *;

-- name: UpdateTrackMetadata :one
-- Full replacement of the editable metadata; ownership is checked by the
-- handler, which answers 403 rather than hiding a track everyone can see.
update tracks set
    title = $2, artist = $3, album = $4, tags = $5::text[],
    year = sqlc.narg('year')::int, bpm = sqlc.narg('bpm')::int,
    updated_at = now()
where id = $1
returning *;

-- name: DeleteTrack :execrows
delete from tracks where id = $1;

-- name: CountTracksBySha :one
-- Asked after a delete: is this blob still referenced by anything?
select count(*)::bigint from tracks where sha256 = $1;

-- name: UserTrackBytes :one
-- What this rider's uploads weigh, against the 2 GB quota (ADR-0015).
select coalesce(sum(size_bytes), 0)::bigint from tracks where uploader_id = $1;
