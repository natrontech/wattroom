-- One row per finished session (ADR-0034): who was in the room, and for how
-- long. Presence and time only — no watts, no kJ, no execution, no heart rate
-- and no per-rider workout reach this table, which is what lets it be durable
-- at all while WATTROOM.md's metrics rules stay untouched.

-- name: SaveSessionRecap :one
-- Idempotent on (room, started_at): the keeper retries (audit 2026-09-09),
-- and the second write of the same session updates rather than duplicates.
insert into session_recaps (room_id, workout, started_at, ended_at, riders)
values ($1, $2, $3, $4, $5)
on conflict (room_id, started_at) do update
    set workout = excluded.workout, ended_at = excluded.ended_at, riders = excluded.riders
returning id, created_at;

-- name: ListRoomRecaps :many
-- The room's most recent, oldest-first for rendering — the same shape and the
-- same reason as ListRoomChat, so the timeline merges two ordered lists rather
-- than sorting one.
select r.id, r.workout, r.started_at, r.ended_at, r.riders
from (
    select * from session_recaps
    where room_id = $1
    order by ended_at desc
    limit $2
) r
order by r.ended_at;

-- The 90-day bound (docs/SPEC.md). A room is a crew, not an attendance
-- register: this is what stops the table answering "where was this person in
-- March".
--
-- Run by internal/housekeeping, NOT on write. This used to be swept when a
-- session ended, by analogy with PruneChat — and the analogy does not hold
-- (#1153). PruneChat's bound is 500 messages, and only a write can exceed a
-- count, so pruning on write is exactly sufficient there. This bound is time,
-- which expires a row with no write involved, so a room that stopped holding
-- sessions kept its recaps forever — the one case the bound exists for.
--
-- Bounded (audit 2026-09-09): one unbounded delete in one transaction on the
-- first sweep after a long gap is the shape every other durable path avoids;
-- the caller loops while a batch comes back full.
-- name: PruneSessionRecaps :execrows
delete from session_recaps
 where ctid in (select ctid from session_recaps
                 where ended_at < now() - make_interval(days => $1::int)
                 limit 10000);

-- name: ExportUserRecaps :many
-- Export-all (#696, GDPR Art. 15 / revFADP Art. 25): the sessions this rider
-- was present for, and their own interval in each. Other riders' intervals are
-- their personal data, not the requester's, so the row is narrowed to theirs —
-- the same rule ExportUserChat follows.
select s.workout, s.started_at, s.ended_at, r.name as room_name, r.slug as room_slug,
       (entry ->> 'from')::bigint as joined_at,
       (entry ->> 'to')::bigint as left_at,
       (entry ->> 'rode')::boolean as rode
from session_recaps s
join rooms r on r.id = s.room_id
cross join lateral jsonb_array_elements(s.riders) entry
where entry ->> 'id' = $1::text
order by s.ended_at;

