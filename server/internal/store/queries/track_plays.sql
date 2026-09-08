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
-- Weight is `recency × skip`, both numbers from docs/SPEC.md:
--   recency: 0.05 the instant a track ends, rising linearly to 1 over 4 h.
--            The floor is why it is a penalty and not a ban.
--   skip:    divided by one more than the times this room skipped it, so
--            one skip halves a track's chances and three quarter them.
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
    ) / (1 + coalesce(h.skips, 0)))::float8 as weight
) w
order by random() ^ (1.0 / w.weight) desc
limit sqlc.arg(lim);
