-- name: RecordTrackPlay :exec
-- One thing a room did with a pool track (#269). Called from outside the
-- room lock, after the deck has already moved on — nothing waits on it.
insert into track_plays (track_id, room_id, queued_by, skipped)
values ($1, $2, $3, $4);

-- name: SmartShuffleTracks :many
-- ADR-0015's smart shuffle: weighted random over the pool in ONE query,
-- penalising what this room played recently and what it keeps skipping.
--
-- The ordering key is `random() ^ (1/weight)` taken descending — weighted
-- sampling without replacement (Efraimidis–Spirakis). A plain
-- `order by random() * weight` is NOT the same thing: it collapses toward
-- picking the heaviest every time, where this draws in proportion.
--
-- Weight is `recency × skip × bpm`, every number from docs/SPEC.md:
--   recency: 0.05 the instant a track ends, rising linearly to 1 over 4 h.
--            The floor is why it is a penalty and not a ban.
--   skip:    divided by one more than the times this room skipped it, so
--            one skip halves a track's chances and three quarter them.
--   bpm:     a BOOST (#270) for a track whose tempo fits the cadence the
--            room is turning, at that cadence or at double it — the same
--            beat, felt one pedal stroke at a time instead of two. A boost
--            rather than a penalty on the rest, so an untagged pool and an
--            idle room both draw exactly as they did before it existed:
--            target_rpm 0 means no session, and a null bpm means nobody has
--            said, and neither is a reason to bury a track.
--
-- History is this room's only (privacy is architecture, WATTROOM.md) — a
-- room with none weights everything at 1, which is a plain random draw.
-- `weight` is returned so a headless autoplay log can say WHY a track came
-- up; the ordering is random and unexplainable after the fact otherwise.
select t.id, t.title, t.artist, w.weight
from tracks t
left join (
    select track_id,
        max(at) filter (where not skipped) as last_played,
        count(*) filter (where skipped) as skips
    from track_plays
    where room_id = sqlc.arg(room_id)
    group by track_id
) h on h.track_id = t.id
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
      end)::float8 as weight
) w
order by random() ^ (1.0 / w.weight) desc
limit sqlc.arg(lim);
