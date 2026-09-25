-- name: CountUsage :one
-- What /metrics says about how much WattRoom is used (#2913): counts, never a
-- row. Windows are by the row's own moment — an account's creation, a ride's
-- start — so a ride uploaded from a buffer a day late lands on the day it was
-- ridden.
-- ponytail: full scans of users and rides every 5 minutes, sub-millisecond at
-- this app's size; an index on rides (started_at) when a count shows in
-- pg_stat_statements.
select
    (select count(*) from users)::bigint                                                    as accounts,
    (select count(*) from users where created_at > now() - interval '1 day')::bigint         as accounts_1d,
    (select count(*) from users where created_at > now() - interval '7 days')::bigint        as accounts_7d,
    (select count(*) from users where created_at > now() - interval '30 days')::bigint       as accounts_30d,
    (select count(distinct user_id) from rides where started_at > now() - interval '1 day')::bigint   as riders_1d,
    (select count(distinct user_id) from rides where started_at > now() - interval '7 days')::bigint  as riders_7d,
    (select count(distinct user_id) from rides where started_at > now() - interval '30 days')::bigint as riders_30d,
    (select count(*) from rides)::bigint                                                    as rides,
    (select coalesce(sum(seconds), 0) from rides)::bigint                                   as ridden_seconds,
    (select coalesce(sum(kj), 0) from rides)::bigint                                        as ridden_kj,
    (select count(*) from crews)::bigint                                                    as crews,
    (select count(*) from workouts where owner_id is not null)::bigint                      as workouts,
    (select count(*) from tracks)::bigint                                                   as tracks,
    (select count(*) from identities where provider = 'strava')::bigint                     as strava_connections,
    (select count(*) from scheduled_sessions where starts_at > now())::bigint               as sessions_upcoming;
