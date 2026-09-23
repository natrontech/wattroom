-- The crew's schedule (#2440, ADR-0058): a plan belongs to the crew and names
-- the voice channel it will run in, or none yet. A plan naming a private
-- channel is that channel's to show — visible_channels is the gate, and a
-- channel's existence is part of what it keeps.

-- name: CreateCrewPlan :one
insert into scheduled_sessions (crew_id, channel_id, workout_name, workout_json, starts_at, created_by)
values (sqlc.arg(crew_id), sqlc.narg(channel_id), sqlc.arg(workout_name), sqlc.arg(workout_json),
        sqlc.arg(starts_at), sqlc.arg(created_by))
returning id, workout_name, workout_json, starts_at, created_by, created_at, reminded_at, started_at, crew_id, channel_id;

-- name: CountCrewUpcoming :one
-- docs/SPEC.md's 100-plan shelf, counted the way ListCrewUpcoming lists: a
-- plan that started, was cancelled or fell past its 30-minute grace has given
-- its slot back. Every plan of the crew, private channels included — the
-- shelf is the crew's.
select count(*) from scheduled_sessions
where crew_id = $1 and starts_at > now() - interval '30 minutes'
  and started_at is null;

-- name: ListCrewUpcoming :many
-- The crew's calendar as the viewer may see it. The tiebreak is ListRoomUpcoming's
-- (#1767): the first row is "next session in this crew" on every read.
-- `audience` is who could answer — the crew, or the channel's people when the
-- plan names one — which the RSVPs are subtracted from (#1011).
select s.id, s.workout_name, s.workout_json, s.starts_at, s.created_by as created_by_id,
       u.display_name as created_by, s.channel_id, coalesce(ch.name, '')::text as channel_name,
       (case when s.channel_id is null
            then (select count(*) from (
                    select cw.owner_id as user_id from crews cw where cw.id = s.crew_id
                    union
                    select cr.user_id from crew_roles cr
                    where cr.crew_id = s.crew_id and cr.role in ('member', 'admin')) m)
            else (select count(*) from visible_channels v where v.channel_id = s.channel_id)
        end)::int as audience
from scheduled_sessions s
join users u on u.id = s.created_by
left join channels ch on ch.id = s.channel_id
where s.crew_id = sqlc.arg(crew_id) and s.starts_at > now() - interval '30 minutes'
  and s.started_at is null
  and (s.channel_id is null
       or exists (select 1 from visible_channels v where v.channel_id = s.channel_id and v.user_id = sqlc.arg(viewer)))
order by s.starts_at, s.created_at, s.id;

-- name: ListCrewRsvps :many
-- Every answer for the crew's upcoming plans, first given first. Only from
-- someone the plan still reaches (#1675): in the crew, and able to enter the
-- channel it names. A decliner's name is not selected (ListRoomRsvps' rule).
select r.session_id, r.user_id, r.going,
       case when r.going then u.display_name else '' end as display_name
from session_rsvps r
join users u on u.id = r.user_id
join scheduled_sessions s on s.id = r.session_id
where s.crew_id = sqlc.arg(crew_id) and s.starts_at > now() - interval '30 minutes'
  and case when s.channel_id is null
        then exists (select 1 from crews cw where cw.id = s.crew_id and cw.owner_id = r.user_id)
          or exists (select 1 from crew_roles cr
                     where cr.crew_id = s.crew_id and cr.user_id = r.user_id and cr.role in ('member', 'admin'))
        else exists (select 1 from visible_channels v where v.channel_id = s.channel_id and v.user_id = r.user_id)
      end
order by r.created_at;

-- name: GetCrewPlan :one
-- One plan of the crew, if the viewer may see it: a plan in a private channel
-- they cannot enter answers as one that does not exist.
select s.id, s.workout_name, s.workout_json, s.starts_at, s.created_by, s.channel_id, s.started_at
from scheduled_sessions s
where s.id = sqlc.arg(id) and s.crew_id = sqlc.arg(crew_id)
  and (s.channel_id is null
       or exists (select 1 from visible_channels v where v.channel_id = s.channel_id and v.user_id = sqlc.arg(viewer)));

-- name: MoveCrewPlan :one
-- RescheduleSession's rule: a move re-arms the reminder, a same-time move
-- does not (#1639).
update scheduled_sessions
set starts_at = sqlc.arg(starts_at),
    reminded_at = case when starts_at = sqlc.arg(starts_at) then reminded_at else null end
where id = sqlc.arg(id) and crew_id = sqlc.arg(crew_id)
returning id, workout_name, workout_json, starts_at, created_by, created_at, reminded_at, started_at, crew_id, channel_id;

-- name: DeleteCrewPlan :one
delete from scheduled_sessions where id = sqlc.arg(id) and crew_id = sqlc.arg(crew_id)
returning workout_name, starts_at, channel_id;

-- name: StartCrewPlan :execrows
-- Once (#1905), and the channel it ran in is kept on a plan that named none.
update scheduled_sessions
set started_at = now(), channel_id = coalesce(channel_id, sqlc.arg(channel_id))
where id = sqlc.arg(id) and crew_id = sqlc.arg(crew_id) and started_at is null;

-- name: GetEnterableVoiceChannel :one
-- A voice channel of this crew the viewer may enter: what a plan may name.
select c.id, c.name from channels c
where c.id = sqlc.arg(id) and c.crew_id = sqlc.arg(crew_id) and c.kind = 'voice'
  and exists (select 1 from visible_channels v where v.channel_id = c.id and v.user_id = sqlc.arg(viewer));

-- name: ListUserCrewPlans :many
-- Home's "What's next" (#325, #2440): every crew the rider is in, one list,
-- with the channels they may enter.
select s.id, s.workout_name, s.workout_json, s.starts_at, s.created_at,
       u.display_name as created_by, s.crew_id, cw.name as crew_name,
       s.channel_id, coalesce(ch.name, '')::text as channel_name
from scheduled_sessions s
join crews cw on cw.id = s.crew_id
join users u on u.id = s.created_by
left join channels ch on ch.id = s.channel_id
where s.starts_at > sqlc.arg(starts_from) and s.starts_at < sqlc.arg(starts_until)
  and s.started_at is null
  and (cw.owner_id = sqlc.arg(user_id)
       or exists (select 1 from crew_roles cr
                  where cr.crew_id = s.crew_id and cr.user_id = sqlc.arg(user_id) and cr.role in ('member', 'admin')))
  and (s.channel_id is null
       or exists (select 1 from visible_channels v where v.channel_id = s.channel_id and v.user_id = sqlc.arg(user_id)))
order by s.starts_at, s.created_at, s.id
limit sqlc.arg(row_limit);

-- name: GetPlanPlace :one
-- What a session mail names (#2440): the crew, and the channel when the plan
-- names one — "Thursday Crew · Pain Cave".
select cw.name as crew_name,
       coalesce((select ch.name from channels ch where ch.id = sqlc.narg(channel_id)::uuid), '')::text as channel_name
from crews cw where cw.id = sqlc.arg(crew_id);

-- name: ListCrewNotifyTargets :many
-- ListRoomNotifyTargets for the crew (#2440): members who asked for
-- planned-session email, both switches on (ADR-0030, #1100 — the crew's
-- `notify` narrows the global one), minus the actor, minus anyone the plan's
-- channel does not admit, and — for the reminder, which names its session —
-- minus anyone who said they are out (#1011). The owner has no crew_roles row
-- until they set a switch, and an unset switch is on.
with members as (
    select cw.owner_id as user_id from crews cw where cw.id = sqlc.arg(crew_id)
    union
    select cr.user_id from crew_roles cr
    where cr.crew_id = sqlc.arg(crew_id) and cr.role in ('member', 'admin')
)
select u.id, u.email, u.unsub_token, u.timezone
from members m
join users u on u.id = m.user_id
left join crew_roles own on own.crew_id = sqlc.arg(crew_id) and own.user_id = u.id
where coalesce(own.notify, true) and u.notify_planned
  -- ADR-0030: nothing but its own confirmation reaches an unverified address.
  and u.email is not null and u.email_verified_at is not null and u.id <> sqlc.arg(actor)
  and (sqlc.narg(channel_id)::uuid is null
       or exists (select 1 from visible_channels v where v.channel_id = sqlc.narg(channel_id)::uuid and v.user_id = u.id))
  and not exists (
      select 1 from session_rsvps v
      where v.session_id = sqlc.narg('session_id')::uuid
        and v.user_id = u.id and not v.going
  );

-- name: ListCrewCalendar :many
-- The crew's iCal feed (#2441, ADR-0021 as amended by ADR-0058). It keeps a
-- month of history and is bounded at both ends (#1414): the whole result is
-- one in-memory ICS string behind a bearer token in a URL. The window and the
-- row limit are the caller's, the same Go constants as the rider feed's.
--
-- What it does not say is not selected (#1767): no planner's name, because
-- the token goes to every member and the feed is meant to be shared with
-- people outside the crew. And no plan in a private channel: that channel's
-- plans are its people's (#2440), and a link a member can forward to anyone
-- must not carry them.
select s.id, s.workout_name, s.workout_json, s.starts_at, s.created_at,
       s.channel_id, coalesce(ch.name, '')::text as channel_name
from scheduled_sessions s
left join channels ch on ch.id = s.channel_id
where s.crew_id = sqlc.arg(crew_id)
  and s.starts_at > sqlc.arg(starts_from) and s.starts_at < sqlc.arg(starts_until)
  and (ch.id is null or not ch.private)
order by s.starts_at, s.created_at, s.id
limit sqlc.arg(row_limit);

-- name: ListUserCalendar :many
-- The rider's own feed (#325, ADR-0021): every crew they are in, the channels
-- they may enter, a month of history — one subscription that follows their
-- crews. The planner's name comes along, because the token is this rider's
-- own and only lists crews that already show them the name.
select s.id, s.workout_name, s.workout_json, s.starts_at, s.created_at,
       u.display_name as created_by, s.crew_id, cw.name as crew_name,
       s.channel_id, coalesce(ch.name, '')::text as channel_name
from scheduled_sessions s
join crews cw on cw.id = s.crew_id
join users u on u.id = s.created_by
left join channels ch on ch.id = s.channel_id
where s.starts_at > sqlc.arg(starts_from) and s.starts_at < sqlc.arg(starts_until)
  and (cw.owner_id = sqlc.arg(user_id)
       or exists (select 1 from crew_roles cr
                  where cr.crew_id = s.crew_id and cr.user_id = sqlc.arg(user_id) and cr.role in ('member', 'admin')))
  and (s.channel_id is null
       or exists (select 1 from visible_channels v where v.channel_id = s.channel_id and v.user_id = sqlc.arg(user_id)))
order by s.starts_at, s.created_at, s.id
limit sqlc.arg(row_limit);

-- name: GetCrewCalendar :one
-- What the crew's feed checks its token against, and names itself for.
select id, name, ics_token from crews where id = $1;

-- name: RotateCrewIcsToken :one
-- The leak escape hatch: the old link, and every calendar subscribed to it,
-- stops the moment this commits.
update crews set ics_token = replace(gen_random_uuid()::text, '-', '')
where id = $1 returning ics_token;

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
returning id, crew_id, channel_id, workout_name, starts_at;

-- name: SetRsvp :exec
-- Planned sessions (#450). One row per rider per session, and the row is an
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
