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

-- name: ListRoomMembers :many
-- Badges ride along (#703): the room's own page is where a crew compares
-- itself, which is the only comparison WATTROOM.md allows. Earned keys
-- only — the achievements table holds nothing else, so there is no
-- progress here to leak (ADR-0027).
select u.*, m.role, m.joined_at,
    user_total_xp(u.id)::bigint as total_xp,
    coalesce((select array_agg(a.key order by a.earned_at)
              from achievements a where a.user_id = u.id), '{}')::text[] as badges
from memberships m
join users u on u.id = m.user_id
where m.room_id = $1
order by m.joined_at
-- An engineering bound, not a product number (#1416): membership is uncapped
-- by SPEC and a crew is nowhere near this; a list must still end somewhere.
limit 1000;

-- name: ListUserRooms :many
-- Banned members keep their row (the ban IS the row) but the room vanishes
-- from their nav.
--
-- Everything the rail draws per room comes along here rather than in a loop
-- of its own (#890): every presence ping makes every online rider re-run
-- this, so it was 1+4N round trips multiplied by the whole fleet. The unread
-- predicate is CountRoomUnread's, unchanged — the rail and a single room must
-- not be able to disagree about what "new" means.
select r.*, m.role, rc.voice_channel_id,
       (select count(*) from memberships mm
         where mm.room_id = r.id and mm.role != 'banned')::bigint as member_count,
       (select count(*)
          from chat_messages cm
          left join room_reads rr on rr.room_id = cm.room_id and rr.user_id = sqlc.arg(user_id)
         where cm.room_id = r.id
           and cm.user_id != sqlc.arg(user_id)
           and (rr.read_at is null or cm.created_at > rr.read_at))::bigint as unread,
       -- coalesced because the lateral is a LEFT join: sqlc reads the column
       -- as non-null from the schema and would scan a room with nothing
       -- planned into a *string, which fails. next_starts_at carries the
       -- "is there one" answer instead — pgtype handles its NULL.
       coalesce(upcoming.workout_name, '')::text as next_workout_name,
       upcoming.starts_at as next_starts_at,
       -- LastRoomChat's row, per room: the one-line preview that makes a room
       -- sortable next to a DM by recency (#468). last_at carries whether
       -- there is one, so the texts coalesce like the workout name above.
       coalesce(last.text, '')::text as last_chat_text,
       coalesce(last.display_name, '')::text as last_chat_from,
       last.image_id as last_chat_image_id,
       last.created_at as last_chat_at,
       -- The crew this room belongs to (ADR-0038), joined rather than fetched
       -- per room: this query's own comment is about the 1+4N it replaced, and
       -- the sidebar's switcher would have reintroduced exactly that. LEFT,
       -- because crew_id is still nullable (ADR-0038's fourth amendment,
       -- corrected sequence in #1301) and a room without one must still list.
       -- Not c.id: r.* already carries crew_id, and selecting both makes sqlc
       -- name the second one CrewID_2.
       coalesce(c.name, '')::text as crew_name,
       coalesce(c.icon, '')::text as crew_icon,
       (c.image_set_at is not null)::boolean as crew_has_image,
       -- The crew's code rides the rail (#1257): every member may share it.
       coalesce(c.code, '')::text as crew_code,
       -- What the caller is to the crew, for the switcher's owner mark and
       -- the crew page's door (#1147). Two booleans, not a role word: the
       -- LEFT join makes a CASE nullable and sqlc would hand back *string.
       coalesce(c.owner_id = sqlc.arg(user_id), false)::boolean as crew_owned,
       exists (select 1 from crew_roles cr
               where cr.crew_id = r.crew_id and cr.user_id = sqlc.arg(user_id)
                 and cr.role = 'admin')::boolean as crew_admin
from memberships m
join rooms r on r.id = m.room_id
left join crews c on c.id = r.crew_id
-- The hub keys by voice channel (#2436): presence per room is asked of it.
left join room_channels rc on rc.room_id = r.id
-- NextRoomSession's row, per room. Same 30-minute grace: a plan stays visible
-- a little past its time, and the read is the cleanup. Same tiebreak as
-- ListRoomUpcoming (#1767) — this `limit 1` and that list's first row are the
-- same claim about which session is next, and the rail and the room have to
-- name the same one.
left join lateral (
    select s.workout_name, s.starts_at
    from scheduled_sessions s
    where s.room_id = r.id and s.starts_at > now() - interval '30 minutes'
      and s.started_at is null
    order by s.starts_at, s.created_at, s.id
    limit 1
) upcoming on true
left join lateral (
    select cm.text, cm.image_id, cm.created_at, u.display_name
    from chat_messages cm
    join users u on u.id = cm.user_id
    where cm.room_id = r.id
    order by cm.created_at desc
    limit 1
) last on true
where m.user_id = sqlc.arg(user_id) and m.role != 'banned'
  -- The room ban is the membership row; the CREW ban is not, and this list
  -- was the door that still opened after one (#1178). Asked through
  -- visible_rooms rather than by writing the crew-ban predicate out here:
  -- ADR-0038's third amendment makes that view the only place allowed to
  -- answer "is this person excluded here", precisely so a join like this one
  -- cannot quietly disagree with the other five.
  --
  -- Still membership-scoped, deliberately: this is your nav, not everything
  -- you may enter. Crew rooms you have not joined are the switcher's to show.
  and exists (
      select 1 from visible_rooms v
      where v.room_id = r.id and v.user_id = m.user_id
  )
order by m.joined_at desc;

-- name: GetMembership :one
select * from memberships where room_id = $1 and user_id = $2;

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

-- name: DeleteRoom :exec
-- Memberships and medals cascade; rides keep their history (room_id set null).
delete from rooms where id = $1;

-- name: UpdateMembershipRole :execrows
update memberships set role = $3 where room_id = $1 and user_id = $2;

-- name: DeleteMembership :execrows
-- A banned row is the ban (#637): leaving must never delete it, whoever asks.
-- Rows, so a caller can tell a delete that declined from one that landed.
delete from memberships where room_id = $1 and user_id = $2 and role != 'banned';

-- name: CreateScheduledSession :one
-- A room's plan is its crew's too (#2440): the crew and the room's voice
-- channel are filled here, so the crew's schedule shows it and its mail and
-- reminder name the crew. Goes with the room routes (#2446).
insert into scheduled_sessions (room_id, crew_id, channel_id, workout_name, workout_json, starts_at, created_by)
select r.id, r.crew_id, (select rc.voice_channel_id from room_channels rc where rc.room_id = r.id),
       sqlc.arg(workout_name), sqlc.arg(workout_json), sqlc.arg(starts_at), sqlc.arg(created_by)
from rooms r where r.id = sqlc.arg(room_id)
returning *;

-- name: LockRoom :exec
-- The room's write lock, held for the length of a transaction. LockUser's
-- sibling: what serialises a room-scoped ceiling check against the insert
-- that follows it.
--
-- Lock order in this app is USERS BEFORE ROOMS. Room create and room
-- hand-over both take LockUser and then touch a rooms row, so a transaction
-- that wants both takes them in that order — the reverse would deadlock a
-- hand-over against a plan made by the incoming owner, and Postgres would
-- resolve it by killing one of them with a 500.
select 1 from rooms where id = $1 for update;

-- name: CountRoomUpcoming :one
-- docs/SPEC.md's 50-planned-session ceiling (#1414). Deliberately the same
-- predicate as ListRoomUpcoming, so what the ceiling counts is exactly what
-- the room shows as planned: a plan that started, was cancelled, or fell past
-- its 30-minute grace has given its slot back.
select count(*) from scheduled_sessions
where room_id = $1 and starts_at > now() - interval '30 minutes'
  and started_at is null;

-- name: ListRoomUpcoming :many
-- Grace of 30 min: a plan stays visible (and startable) a little past its
-- time, then falls off — no cron, the read is the cleanup. A started plan
-- is done with (#1905). Uncapped like the rider's calendar (#1908): ten
-- silently shown of thirteen planned had the two disagreeing about one room.
--
-- A room may plan two sessions for the same minute (docs/SPEC.md), so the
-- tiebreak is load-bearing: the first row of this list is what the place
-- labels "next session in this room", and `starts_at` alone left that label
-- on whichever of the two rows Postgres felt like returning first — a
-- different one between two reads of an unchanged room (#1767). Created
-- first leads; the id settles a same-instant insert so the order is total.
select s.id, s.workout_name, s.workout_json, s.starts_at, u.display_name as created_by
from scheduled_sessions s
join users u on u.id = s.created_by
where s.room_id = $1 and s.starts_at > now() - interval '30 minutes'
  and s.started_at is null
order by s.starts_at, s.created_at, s.id;

-- name: MarkSessionStarted :execrows
-- Once: the row count says whether this was the first start (#1905).
update scheduled_sessions
set started_at = now()
where id = $1 and room_id = $2 and started_at is null;

-- name: DeleteScheduledSession :one
-- Returns the name so the room's timeline can say which plan went (#359), and
-- the time so the cancellation mail can say which session it was and skip one
-- that has already been and gone (#839).
delete from scheduled_sessions where id = $1 and room_id = $2
returning workout_name, starts_at;

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

-- name: RescheduleSession :one
-- A moved session is reminded again for its new time: the claim above is
-- keyed on reminded_at, and a move past an already-sent reminder used to
-- leave the real start with no mail at all. The reminder stays armed as it
-- was when the time did not change (#1639), and the old start comes back
-- so the handler can tell a move from a no-op.
update scheduled_sessions
set starts_at = $3,
    reminded_at = case when starts_at = $3 then reminded_at else null end
where id = $1 and room_id = $2
returning *;

-- name: GetScheduledSessionStart :one
select starts_at from scheduled_sessions where id = $1 and room_id = $2;

-- name: CountOwnedRooms :one
select count(*) from rooms where owner_id = $1;

-- name: TransferRoom :exec
-- The room changes hands (#1227). Always with both membership rows
-- rewritten in the same transaction: the owner column and the 'owner'
-- role are two answers to one question and must not disagree.
update rooms set owner_id = $2 where id = $1;

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

-- name: SessionInRoom :one
-- A plan belongs to the room in its URL — an RSVP cannot reach across rooms.
select id from scheduled_sessions where id = $1 and room_id = $2;

-- name: ListRoomRsvps :many
-- Every answer, for everything ListRoomUpcoming returns. Ordered by when it
-- was given, so the first names in the "who is in" line are the ones who
-- committed first.
--
-- The declines come along as a column rather than being filtered out here
-- (#1011): the room shows who is in by name and how many are out as a
-- number, and one query that returns both is what keeps the two numbers
-- reading the same room.
--
-- A decliner's name is NOT SELECTED, rather than selected and dropped in Go
-- — ListRoomCalendar's rule, for the same reason: what a query must not say,
-- it does not say, and no future handler can render what never arrived. The
-- id still comes, because the caller has to be told their own answer; the
-- name is the thing a screen would print.
select r.session_id, r.user_id, r.going,
       case when r.going then u.display_name else '' end as display_name
from session_rsvps r
join users u on u.id = r.user_id
join scheduled_sessions s on s.id = r.session_id
-- Someone removed or banned since they said yes is not coming (#1675): the
-- row stays, the line does not name them.
join memberships m on m.room_id = s.room_id and m.user_id = r.user_id and m.role <> 'banned'
where s.room_id = $1 and s.starts_at > now() - interval '30 minutes'
order by r.created_at;

-- name: SetMembershipPrefs :one
-- A rider's own settings for one room (#1100). Keyed on (room, user), so the
-- WHERE clause is the authorization: there is no way to spell another
-- rider's preferences, however the caller addresses the request.
update memberships set notify = $3, on_board = $4
where room_id = $1 and user_id = $2
returning notify, on_board;

-- name: ListListedRooms :many
-- The opt-in public directory (#1118, ADR-0039). Every room whose owner has
-- chosen to be findable, and NOTHING ELSE ABOUT THEM.
--
-- The columns are the whole disclosure decision, so they are the thing to
-- read twice: name, icon, slug. No member count, no activity, no owner, no
-- last-ridden. A directory entry is a way to find the door, not a window —
-- and #1025 is still open on whether a room-MATE may see the counts behind a
-- badge, which settles it for a stranger who has not joined at all.
--
-- Adding a column here later widens what strangers see and is a decision.
-- Removing one narrows it and breaks a promise already made. The narrow
-- version is the one that can still move.
--
-- Ordered by name because there is no other honest order: "most active" and
-- "biggest" are the disclosures this deliberately does not make.
select r.slug, r.name, r.icon
from rooms r
where r.listed
order by r.name asc, r.slug asc
limit sqlc.arg(lim) offset sqlc.arg(off);
