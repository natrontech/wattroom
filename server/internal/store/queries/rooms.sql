-- name: CreateRoom :one
insert into rooms (code, slug, name, owner_id)
values ($1, $2, $3, $4)
returning *;

-- name: GetRoomByCode :one
select * from rooms where code = $1;

-- name: GetRoomBySlug :one
select * from rooms where slug = $1;

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
order by m.joined_at;

-- name: ListUserRooms :many
-- Banned members keep their row (the ban IS the row) but the room vanishes
-- from their nav.
select r.*, m.role
from memberships m
join rooms r on r.id = m.room_id
where m.user_id = $1 and m.role != 'banned'
order by m.joined_at desc;

-- name: GetMembership :one
select * from memberships where room_id = $1 and user_id = $2;

-- name: ListMembershipsForUser :many
-- Batched sibling of GetMembership (#687): one query for every room a
-- viewer's online friends are in, instead of one membership check per friend.
select * from memberships where user_id = sqlc.arg(user_id) and room_id = any(sqlc.arg(room_ids)::uuid[]);

-- name: UpdateRoom :one
update rooms set name = $2, listed = $3, sound_pack = $4, icon = $5, cheers = $6
where id = $1 returning *;

-- name: DeleteRoom :exec
-- Memberships and medals cascade; rides keep their history (room_id set null).
delete from rooms where id = $1;

-- name: UpdateMembershipRole :exec
update memberships set role = $3 where room_id = $1 and user_id = $2;

-- name: DeleteMembership :exec
-- A banned row is the ban (#637): leaving must never delete it, whoever asks.
delete from memberships where room_id = $1 and user_id = $2 and role != 'banned';

-- name: CountRoomMembers :one
select count(*) from memberships where room_id = $1 and role != 'banned';

-- name: CreateScheduledSession :one
insert into scheduled_sessions (room_id, workout_name, workout_json, starts_at, created_by)
values ($1, $2, $3, $4, $5) returning *;

-- name: ListRoomUpcoming :many
-- Grace of 30 min: a plan stays visible (and startable) a little past its
-- time, then falls off — no cron, the read is the cleanup.
select s.id, s.workout_name, s.workout_json, s.starts_at, u.display_name as created_by
from scheduled_sessions s
join users u on u.id = s.created_by
where s.room_id = $1 and s.starts_at > now() - interval '30 minutes'
order by s.starts_at
limit 10;

-- name: NextRoomSession :one
select workout_name, starts_at from scheduled_sessions
where room_id = $1 and starts_at > now() - interval '30 minutes'
order by starts_at limit 1;

-- name: DeleteScheduledSession :one
-- Returns the name so the room's timeline can say which plan went (#359).
delete from scheduled_sessions where id = $1 and room_id = $2
returning workout_name;

-- name: RescheduleSession :one
update scheduled_sessions set starts_at = $3
where id = $1 and room_id = $2 returning *;

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
where s.room_id = $1 and s.starts_at > now() - interval '30 minutes'
order by r.created_at;
