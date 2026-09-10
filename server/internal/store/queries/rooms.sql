-- name: CreateRoom :one
insert into rooms (slug, name, owner_id)
values ($1, $2, $3)
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
select r.*, m.role,
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
       -- because crew_id is nullable for one release (ADR-0038's fourth
       -- amendment) and a room without one must still list.
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
-- NextRoomSession's row, per room. Same 30-minute grace: a plan stays visible
-- a little past its time, and the read is the cleanup.
left join lateral (
    select s.workout_name, s.starts_at
    from scheduled_sessions s
    where s.room_id = r.id and s.starts_at > now() - interval '30 minutes'
      and s.started_at is null
    order by s.starts_at
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
insert into scheduled_sessions (room_id, workout_name, workout_json, starts_at, created_by)
values ($1, $2, $3, $4, $5) returning *;

-- name: ListRoomUpcoming :many
-- Grace of 30 min: a plan stays visible (and startable) a little past its
-- time, then falls off — no cron, the read is the cleanup. A started plan
-- is done with (#1905). Uncapped like the rider's calendar (#1908): ten
-- silently shown of thirteen planned had the two disagreeing about one room.
select s.id, s.workout_name, s.workout_json, s.starts_at, u.display_name as created_by
from scheduled_sessions s
join users u on u.id = s.created_by
where s.room_id = $1 and s.starts_at > now() - interval '30 minutes'
  and s.started_at is null
order by s.starts_at;

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
returning id, room_id, workout_name, starts_at;

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

-- name: ListRoomCalendar :many
-- The iCal feed (#245): unlike the in-room list, it keeps a month of history
-- and has no cap — a calendar that self-erases reads as broken.
select s.id, s.workout_name, s.workout_json, s.starts_at, s.created_at,
       u.display_name as created_by
from scheduled_sessions s
join users u on u.id = s.created_by
where s.room_id = $1 and s.starts_at > now() - interval '30 days'
order by s.starts_at;

-- name: RotateRoomIcsToken :one
update rooms set ics_token = replace(gen_random_uuid()::text, '-', '')
where id = $1 returning ics_token;

-- name: CountOwnedRooms :one
select count(*) from rooms where owner_id = $1;

-- name: TransferRoom :exec
-- The room changes hands (#1227). Always with both membership rows
-- rewritten in the same transaction: the owner column and the 'owner'
-- role are two answers to one question and must not disagree.
update rooms set owner_id = $2 where id = $1;

-- name: ListUserCalendar :many
-- Every room the rider is in, one list (#325). $2 is the horizon and is the
-- only difference between the two callers: the iCal feed keeps a month of
-- history, the sessions page starts at the same 30-minute grace the in-room
-- list uses. Uncapped — a calendar that self-erases reads as broken.
select s.id, s.workout_name, s.workout_json, s.starts_at, s.created_at,
       u.display_name as created_by, r.name as room_name, r.slug as room_slug,
       m.role as your_role
from scheduled_sessions s
join rooms r on r.id = s.room_id
join memberships m on m.room_id = s.room_id and m.user_id = $1 and m.role <> 'banned'
join users u on u.id = s.created_by
where s.starts_at > $2
  -- A crew ban leaves the membership row and lives in visible_rooms alone
  -- (#1904): the rail asks it, and so does the calendar.
  and exists (select 1 from visible_rooms v where v.room_id = s.room_id and v.user_id = $1)
order by s.starts_at;

-- name: SetRsvp :exec
-- Room events (#450). Saying yes twice is saying yes.
insert into session_rsvps (session_id, user_id) values ($1, $2)
on conflict do nothing;

-- name: ClearRsvp :exec
delete from session_rsvps where session_id = $1 and user_id = $2;

-- name: SessionInRoom :one
-- A plan belongs to the room in its URL — an RSVP cannot reach across rooms.
select id from scheduled_sessions where id = $1 and room_id = $2;

-- name: ListRoomRsvps :many
-- Who is in, for everything ListRoomUpcoming returns. Ordered by when they
-- said yes, so the first names in the line are the ones who committed first.
select r.session_id, r.user_id, u.display_name
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
