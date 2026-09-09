-- name: CreateTrack :one
-- Content-addressed: a second upload of the same bytes hits the unique index
-- on sha256, and the caller reads the existing row instead of storing a copy.
insert into tracks (sha256, uploaded_by, title, artist, album, duration_ms, size_bytes, bpm, tags)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
returning *;

-- name: TrackBySha :one
-- THIS uploader's row for this content (#1095). Scoped, because the point of
-- the scoping is that a second person uploading a song someone else already
-- has gets a row of their own rather than a look at theirs.
select * from tracks where uploaded_by = $1 and sha256 = $2;

-- name: GetTrack :one
-- Scoped (#1095): another shelf's track is not "forbidden", it is absent —
-- 404 rather than 403, because telling a stranger that a track exists and is
-- not theirs is itself the leak.
select * from tracks where id = $1 and uploaded_by = $2;

-- name: TrackPlayableBy :one
-- The audio endpoint's own resolver (#1095), and deliberately WIDER than
-- GetTrack: a track is playable by whoever uploaded it, and by anyone who
-- may enter a room its uploader may enter.
--
-- It has to be. A pool track on a room's deck is fetched by EVERY rider in
-- that room from this endpoint (`AudioDeck.svelte`), so scoping it to the
-- uploader would leave a queued track playing for its owner and silent for
-- everyone else — the feature #267 exists for, broken with no error anywhere.
--
-- The line this draws is playing versus browsing: sharing a room already
-- means hearing what the others put on, and #1085 lets a member queue their
-- own track for the room by hand. It does NOT mean reading their library —
-- list, search, facets, edit and delete all stay on GetTrack, uploader-only.
-- A caller still needs the track's uuid, which only the deck hands out.
--
-- "Shares a room" is asked of visible_rooms since ADR-0038 (#1103, Phase 2 of
-- #1095): the pair may both ENTER one room, which is the crew scope the ADR
-- intends — a room open to its crew counts for everyone in the crew — and is
-- the same rule person-visibility follows (#1135). It also retires the
-- hand-written `role != 'banned'` this query carried: a crew ban leaves the
-- membership row in place, so that guard let a crew-banned rider keep
-- fetching a crew-mate's bytes. Widening only, per the issue: nobody who
-- could hear a track before loses it, except the banned.
select t.* from tracks t
where t.id = sqlc.arg(id)
  and (t.uploaded_by = sqlc.arg(user_id)
       or exists (
           select 1 from visible_rooms mine
           join visible_rooms theirs on theirs.room_id = mine.room_id
           where mine.user_id = sqlc.arg(user_id)
             and theirs.user_id = t.uploaded_by
       ));

-- name: ListTracks :many
-- This rider's shelf (#1095 Phase 1 — ADR-0015 amended), newest first.
-- Carries the uploader's name so a track has a face; it is always their own
-- for now, and stays a join so Phase 2's crew scope needs no new query.
--
-- An empty search returns everything: the browse view and the search view are
-- one query, so a rider clearing the box gets the library back rather than a
-- second code path that might disagree with the first.
select t.*, u.display_name as uploaded_by_name
from tracks t
join users u on u.id = t.uploaded_by
where t.uploaded_by = sqlc.arg(uploaded_by)
  and (sqlc.arg(search)::text = ''
       or t.search @@ to_tsquery('simple', sqlc.arg(search)::text))
  and (sqlc.arg(tag)::text = '' or sqlc.arg(tag)::text = any(t.tags))
order by
    -- Ranked when there is a query, newest when there is not.
    case when sqlc.arg(search)::text = '' then 0
         else ts_rank(t.search, to_tsquery('simple', sqlc.arg(search)::text))
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
update tracks set title = $3, artist = $4, album = $5, bpm = $6, tags = $7
where id = $1 and uploaded_by = $2
returning *;

-- name: TrackTagCounts :many
-- The facet row: every tag on THIS rider's shelf with how many tracks wear
-- it (#1095). Counting over the whole instance would have been a listing of
-- what strangers are into, which is the leak in miniature.
--
-- Counted over the whole pool rather than over the current search, so a rider
-- narrowing by text still sees the shelf they can jump to. Cheap enough to run
-- beside every list — a pool of a few thousand rows aggregates in under a
-- millisecond, and there is no page of tags to paginate.
-- The cast is not decoration: without it sqlc types an unnested element as
-- `interface{}` and the handler has to assert what the column already is.
select tag::text as tag, count(*)::bigint as tracks
from tracks, unnest(tags) as tag
where tracks.uploaded_by = $1
group by tag
order by tracks desc, tag
limit 100;

-- name: DeleteTrack :one
-- Returns the sha, and whether anyone ELSE still holds that content (#1095).
-- One blob per sha on disk however many shelves point at it, so the file may
-- only go with the last row — deleting it while another rider still holds
-- the row breaks their playback, and nothing says so until they press play.
--
-- `others` counts rows excluding the one being deleted BY ID rather than
-- relying on the delete being visible: a data-modifying CTE's effect is not
-- visible to the rest of the same statement, so a plain count would include
-- the row just removed and every delete would look like it had company.
with gone as (
    delete from tracks t where t.id = sqlc.arg(id) and t.uploaded_by = sqlc.arg(uploaded_by)
    returning t.sha256
)
select gone.sha256,
    (select count(*) from tracks t
     where t.sha256 = gone.sha256 and t.id <> sqlc.arg(id))::bigint as others
from gone;
