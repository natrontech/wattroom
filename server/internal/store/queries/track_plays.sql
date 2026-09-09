-- name: RecordTrackPlay :exec
-- One thing a room did with a track (#269, #1432): a library track by id or
-- a video by its YouTube id and title. Called from outside the room lock,
-- after the deck has already moved on — nothing waits on it.
insert into track_plays (track_id, room_id, queued_by, skipped, video_id, title)
values ($1, $2, $3, $4, $5, $6);

-- name: RecentRoomPlays :many
-- The room's "just played" as the database remembers it (#1432), newest
-- first, both kinds. A library row reads the track's current title and
-- artist; a deleted file took its rows with it.
select p.track_id, p.video_id, p.title, p.skipped,
    coalesce(t.title, '')::text as track_title,
    coalesce(t.artist, '')::text as track_artist,
    coalesce(t.bpm, 0)::int as track_bpm,
    coalesce(u.display_name, '')::text as queued_by_name
from track_plays p
left join tracks t on t.id = p.track_id
left join users u on u.id = p.queued_by
where p.room_id = $1 and (p.track_id is not null or p.video_id <> '')
order by p.at desc
limit $2;

-- name: SmartShuffleTracks :many
-- ADR-0015's smart selection, all of it, as ONE scoring pass: a weighted
-- random draw over the pool where the weight is the product of four factors.
-- No second query, no reranking step, no model (the ADR's ponytail ceiling).
--
-- The ordering key is `random() ^ (1/weight)` taken descending — weighted
-- sampling without replacement (Efraimidis–Spirakis). A plain
-- `order by random() * weight` is NOT the same thing: it collapses toward
-- picking the heaviest every time, where this draws in proportion.
--
-- Weight is `recency × skip × bpm × affinity`, every number from docs/SPEC.md:
--   recency:  0.05 the instant a track ends, rising linearly to 1 over 4 h.
--             The floor is why it is a penalty and not a ban.
--   skip:     divided by one more than the times this room skipped it, so
--             one skip halves a track's chances and three quarter them.
--   bpm:      a BOOST (#270) for a track whose tempo fits the cadence the
--             room is turning, at that cadence or at double it — the same
--             beat, felt one pedal stroke at a time instead of two.
--   affinity: a BOOST (#271) for a track that resembles what this room has
--             lately played THROUGH — same artist, or a tag in common. Same
--             artist is the strong signal and earns more: tags are
--             free-form with no taxonomy (ADR-0015), so a broad one says
--             much less than a name does. A track the room just finished is
--             excluded from its own affinity: "more like that", not "that
--             again", which is what the recency penalty already answers.
--
-- Every one of them is a boost or a penalty on a base of 1, so each is
-- individually switch-off-able by its own inputs: no session means no BPM
-- preference, an empty history means no affinity and no penalties, and a
-- room with none of it draws uniformly at random. That is the pre-#269
-- behaviour, reached by the arithmetic rather than by a branch.
--
-- History is this room's only (privacy is architecture, WATTROOM.md): what
-- one room finishes is not a fact about the pool, and must not reach another.
--
-- And the POOL it draws from is this room's members' (#1095). Autoplay is the
-- one path that reaches for a track nobody asked for by name, so an unscoped
-- draw here would put a stranger's upload on the deck without ever appearing
-- on a page or in a search — past every check the issue's own list names.
-- Members rather than the acting rider: a room's shelf is what its people
-- brought, which is already what the room permits (any member may queue their
-- own track for everyone). Phase 2 replaces this join with the crew.
-- `weight` is returned so a headless autoplay log can say WHY a track came
-- up; the ordering is random and unexplainable after the fact otherwise.
with history as (
    select p.track_id,
        max(p.at) filter (where not p.skipped) as last_played,
        count(*) filter (where p.skipped) as skips
    from track_plays p
    where p.room_id = sqlc.arg(room_id)
    group by p.track_id
),
-- The last few tracks this room let finish. Bounded, and by COUNT rather
-- than by time: a room's taste is the last things it enjoyed, and a room
-- that rode yesterday should not come back to a blank slate.
recent as (
    select p.track_id, t.artist, t.tags
    from track_plays p
    join tracks t on t.id = p.track_id
    where p.room_id = sqlc.arg(room_id) and not p.skipped
    order by p.at desc
    limit sqlc.arg(affinity_window)
),
liked as (
    select
        coalesce(array_agg(distinct track_id), '{}') as ids,
        coalesce(array_agg(distinct artist) filter (where artist <> ''), '{}') as artists,
        coalesce(array_agg(distinct tag) filter (where tag is not null), '{}') as tags
    from recent left join lateral unnest(recent.tags) as tag on true
)
select t.id, t.title, t.artist, coalesce(t.bpm, 0)::int as bpm, w.weight
from tracks t
-- The shelves of the room's own MEMBERS, confirmed on purpose in #1103 over
-- the crew: crew membership follows room membership, so a crew-wide draw
-- would put a shelf into the rotation of rooms its owner never entered.
-- Members who may still enter, through visible_rooms — a crew-banned member
-- keeps their row but not their say in what the room plays (ADR-0038).
join memberships m on m.user_id = t.uploaded_by and m.room_id = sqlc.arg(room_id)
join visible_rooms v on v.room_id = m.room_id and v.user_id = m.user_id
left join history h on h.track_id = t.id
cross join liked l
cross join lateral (
    select (greatest(
        case
            when h.last_played is null then 1.0
            else least(extract(epoch from (now() - h.last_played)) / 14400.0, 1.0)
        end,
        0.05
    ) / (1 + coalesce(h.skips, 0))
    * case
        when sqlc.arg(target_rpm)::float8 <= 0 or t.bpm is null then 1.0
        when abs(t.bpm - sqlc.arg(target_rpm)::float8)
                 <= sqlc.arg(target_rpm)::float8 * sqlc.arg(bpm_tolerance)::float8
          or abs(t.bpm - sqlc.arg(target_rpm)::float8 * 2)
                 <= sqlc.arg(target_rpm)::float8 * 2 * sqlc.arg(bpm_tolerance)::float8
        then sqlc.arg(bpm_boost)::float8
        else 1.0
      end
    * case
        -- A track the room just finished matches its OWN artist, and lifting
        -- it here would partly undo the recency penalty that exists to stop
        -- the room hearing it again. Affinity means "more like that one",
        -- never "that one again" — so the recency factor keeps this case.
        when t.id = any(l.ids) then 1.0
        -- A name is a name; a tag is a hint. Checked in that order so a
        -- track that is both does not earn the weaker one. An untitled
        -- artist cannot match another untitled artist: the `filter` on
        -- `liked.artists` above is what guarantees it, and is the ONLY thing
        -- that does — a second `t.artist <> ''` here would read as the
        -- guard while the filter quietly did the work.
        when t.artist = any(l.artists) then sqlc.arg(artist_boost)::float8
        when t.tags && l.tags then sqlc.arg(tag_boost)::float8
        else 1.0
      end)::float8 as weight
) w
-- Smart is an ORDER, not a source (#1429): with an active playlist that holds
-- library tracks, the draw is over those and nothing else; `within` is empty
-- when no list is active or the list holds no library track, and the draw
-- is then the members' whole libraries as before. coalesce, because a nil
-- slice arrives as NULL and NULL = 0 is not true.
where coalesce(cardinality(sqlc.arg(within)::uuid[]), 0) = 0
   or t.id = any(sqlc.arg(within)::uuid[])
order by random() ^ (1.0 / w.weight) desc
limit sqlc.arg(lim);
