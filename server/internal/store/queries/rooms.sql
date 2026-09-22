-- name: CreateRoom :one
-- A room is born in its crew (ADR-0038, #1301). The crew used to arrive a
-- statement later, from PlaceRoomInCrew, which meant every room this app has
-- ever made existed crew-less for the width of one transaction. Invisible to
-- anyone outside it, and fatal to the contract half: a `not null` on crew_id
-- (and equally any `check (crew_id is not null)`, NOT VALID or otherwise) is
-- evaluated on THIS insert, so the constraint #1301 asks for would have
-- broken room creation on a database with zero null rows. The count the
-- issue was waiting on would have come back 0 and the release would still
-- have gone down.
--
-- crew_visible is written here for the same reason and keeps its failsafe:
-- the column's default is false, so a call site that names no value still
-- gets the private one (20260908145114's argument, RESEARCH.md 16.3).
insert into rooms (slug, name, owner_id, crew_id, crew_visible)
values ($1, $2, $3, $4, $5)
returning *;

-- name: GetRoomBySlug :one
select * from rooms where slug = $1;

-- name: GetRoomByID :one
select * from rooms where id = $1;

-- name: GetRoomsBySlugs :many
-- Batched sibling of GetRoomBySlug (#687): the friends panel resolves every
-- online friend's room in one query instead of one per friend.
select * from rooms where slug = any(sqlc.arg(slugs)::text[]);

-- name: CreateMembership :exec
insert into memberships (room_id, user_id, role)
values ($1, $2, $3)
on conflict (room_id, user_id) do nothing;

-- name: ListMembershipsForUser :many
-- Batched sibling of GetMembership (#687): one query for every room a
-- viewer's online friends are in, instead of one membership check per friend.
select * from memberships where user_id = sqlc.arg(user_id) and room_id = any(sqlc.arg(room_ids)::uuid[]);

-- name: UpdateRoom :one
-- listed implies crew_visible (#1671): the directory is a door onto the crew,
-- and a room shut to the crew is not a public one.
update rooms set name = $2, listed = ($3 and $8), sound_pack = $4, icon = $5, cheers = $6,
                 board_enabled = $7, crew_visible = $8
where id = $1 returning *;

-- name: UpdateMembershipRole :execrows
update memberships set role = $3 where room_id = $1 and user_id = $2;

-- name: CreateScheduledSession :one
-- A room's plan is its crew's too (#2440): the crew and the room's voice
-- channel are filled here, so the crew's schedule shows it and its mail and
-- reminder name the crew. Goes with the room routes (#2446).
insert into scheduled_sessions (room_id, crew_id, channel_id, workout_name, workout_json, starts_at, created_by)
select r.id, r.crew_id, (select rc.voice_channel_id from room_channels rc where rc.room_id = r.id),
       sqlc.arg(workout_name), sqlc.arg(workout_json), sqlc.arg(starts_at), sqlc.arg(created_by)
from rooms r where r.id = sqlc.arg(room_id)
returning *;

-- name: ClaimSessionsToRemind :many
-- The claim IS the update (#841): a row leaves this query already marked, so a
-- tick that fires twice, a restart mid-send or a second instance cannot mail
-- the same session again. Callers do not mark anything afterwards, which is
-- the point — there is no window between reading and claiming to lose a
-- process in.
--
-- A session whose start slipped past while the server was down falls outside
-- the window and is simply never reminded. That is deliberate: a burst of
-- "starts in an hour" for sessions that began three hours ago is worse than
-- silence.
--
-- Bounded (audit 2026-09-09): the claim is final, so a batch the minute's
-- budget cannot mail is lost, not late. A hundred a tick against an hour's
-- window leaves fifty-nine more ticks for the rest.
update scheduled_sessions
set reminded_at = now()
where id in (
    select id from scheduled_sessions
    where reminded_at is null
      and started_at is null
      and starts_at > now()
      and starts_at <= now() + interval '1 hour'
    order by starts_at
    limit 100
)
returning id, room_id, crew_id, channel_id, workout_name, starts_at;

-- name: SetRsvp :exec
-- Room events (#450). One row per rider per session, and the row is an
-- ANSWER (#1011): `going` says which of the two it is, and no row at all is
-- the third state — nobody has looked yet. Saying the same thing twice is
-- saying it once; changing your mind rewrites the row rather than needing a
-- delete first, so there is no moment where a rider has no answer on record.
--
-- created_at moves only when the answer actually changed, because that is
-- what ListRoomRsvps orders the "who is in" line by: a rider who said no in
-- the morning and yes in the evening committed in the evening, and would
-- otherwise sort ahead of everyone who said yes at lunchtime.
insert into session_rsvps (session_id, user_id, going) values ($1, $2, $3)
on conflict (session_id, user_id) do update
set going = excluded.going,
    created_at = case when session_rsvps.going = excluded.going
                      then session_rsvps.created_at else now() end;

-- name: ClearRsvp :exec
-- Taking the answer back — in or out, the row goes and the rider is
-- unanswered again.
delete from session_rsvps where session_id = $1 and user_id = $2;

-- name: ClearSessionDeclines :exec
-- A moved session asks the people who said no again (#1011). Only the
-- declines: somebody who said they are in for a Tuesday has not said
-- anything about a Wednesday either, but the cost of guessing wrong is
-- asymmetric — dropping an "in" empties a line the room reads, while a
-- decline that survives a move silences a reminder for a session the rider
-- never turned down. Run on the same condition as the reminder's re-arm in
-- RescheduleSession: only when the time really changed.
delete from session_rsvps where session_id = $1 and not going;

-- name: SetMembershipPrefs :one
-- A rider's own settings for one room (#1100). Keyed on (room, user), so the
-- WHERE clause is the authorization: there is no way to spell another
-- rider's preferences, however the caller addresses the request.
update memberships set notify = $3, on_board = $4
where room_id = $1 and user_id = $2
returning notify, on_board;
