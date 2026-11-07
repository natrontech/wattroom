-- name: AddVoiceSeconds :exec
-- Hangout time (docs/spec/lounge.md), a counter that pays no XP or Batzen.
-- One batch of the hub's minutes: the same seconds to each rider named, in
-- one statement. A rider who deleted their account since the minute was
-- counted is skipped, not a failed batch.
insert into user_voice_time (user_id, seconds)
select u.id, sqlc.arg(seconds)::bigint
from users u
where u.id = any(sqlc.arg(user_ids)::uuid[])
on conflict (user_id) do update set seconds = user_voice_time.seconds + excluded.seconds;

-- name: AddCrewTogether :exec
-- The same for the crews, by voice channel: the hub counts channels, and a
-- channel's crew is the database's to know. Two channels of one crew add up.
insert into crew_together (crew_id, seconds)
select ch.crew_id, count(*) * sqlc.arg(seconds)::bigint
from channels ch
where ch.id = any(sqlc.arg(channel_ids)::uuid[]) and ch.kind = 'voice'
group by ch.crew_id
on conflict (crew_id) do update set seconds = crew_together.seconds + excluded.seconds;

-- name: UserVoiceSeconds :one
-- The rider's own hangout time, zero before their first minute.
select coalesce((select seconds from user_voice_time where user_id = $1), 0)::bigint;

-- name: CrewTogetherSeconds :one
-- The crew's time together in voice, zero before its first minute.
select coalesce((select seconds from crew_together where crew_id = $1), 0)::bigint;

-- name: RiderLogbook :one
-- The logbook on the cozy room's desk: the rider's own numbers, for them
-- alone. XP is user_total_xp, the number every level is drawn from (#690).
select user_total_xp(sqlc.arg(user_id))::bigint as total_xp,
       (select count(*) from rides r where r.user_id = sqlc.arg(user_id))::bigint as rides,
       (select coalesce(sum(r.seconds), 0) from rides r where r.user_id = sqlc.arg(user_id))::bigint as ride_seconds,
       coalesce((select v.seconds from user_voice_time v where v.user_id = sqlc.arg(user_id)), 0)::bigint as voice_seconds;
