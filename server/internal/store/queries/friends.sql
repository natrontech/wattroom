-- name: CreateFriendRequest :execrows
-- 0 rows: the pair already has a request or a friendship, in either direction
-- (the pkey and the pair index). The handler expects that refusal, so it is
-- not left to Postgres to log as an ERROR (#2685).
insert into friendships (requester_id, addressee_id) values ($1, $2)
on conflict do nothing;

-- name: GetFriendship :one
-- Either direction — one row exists per pair (the pair index).
select * from friendships
where (requester_id = $1 and addressee_id = $2)
   or (requester_id = $2 and addressee_id = $1);

-- name: AcceptFriendRequest :execrows
-- Only the addressee accepts.
update friendships set status = 'accepted'
where requester_id = $1 and addressee_id = $2 and status = 'pending';

-- name: DeleteFriendship :execrows
-- Cancel, dismiss, or unfriend — same act from either side.
delete from friendships
where (requester_id = $1 and addressee_id = $2)
   or (requester_id = $2 and addressee_id = $1);

-- name: ListFriendships :many
-- All rows involving me, resolved to the other person. Avatar + lifetime XP
-- ride along for the friend rows' avatars (#253); created_at is what makes a
-- request announceable exactly once, in exactly one tab (#876).
select f.status, f.requester_id, f.created_at, u.id, u.display_name, u.avatar_url,
    user_total_xp(u.id)::bigint as total_xp
from friendships f
join users u on u.id = case when f.requester_id = $1 then f.addressee_id else f.requester_id end
where f.requester_id = $1 or f.addressee_id = $1
order by u.display_name
limit 1000; -- an engineering bound (#1416), far past any friend list

-- name: GetUserByFriendCode :one
-- The formation gate (ADR-0012 amendment): knowing the code IS the permission
-- to ask.
select * from users where friend_code = $1;

-- name: NoteFriendDecline :exec
-- The addressee dismissed a pending ask (#876). Asking again and being
-- dismissed again is a new event, so the timestamp moves.
insert into friend_declines (requester_id, addressee_id) values ($1, $2)
on conflict (requester_id, addressee_id)
do update set declined_at = now();

-- name: ListFriendDeclines :many
-- Mine to hear, never theirs: only the rider who asked reads this.
select d.declined_at, u.id, u.display_name
from friend_declines d
join users u on u.id = d.addressee_id
where d.requester_id = $1;

-- name: RestoreFriendRequest :execrows
-- The undo of a dismissal (#1652) and only that (#2225): the ask comes back
-- where the tombstone says there was one to dismiss. Unconditional, this
-- insert MADE a pending request — `status` defaults to 'pending' — so two
-- calls, restore then accept, befriended a stranger who was never asked.
-- A pair that is already connected again is left alone by the conflict.
insert into friendships (requester_id, addressee_id)
select $1, $2
where exists (
    select 1 from friend_declines
    where requester_id = $1 and addressee_id = $2
)
on conflict do nothing;

-- name: PruneFriendDeclines :execrows
-- A dismissal is said once (ADR-0012 amendment); the tombstone exists so a
-- device that never heard it is told. Past the recap retention nothing is
-- left to tell (#1654).
delete from friend_declines
 where ctid in (select ctid from friend_declines
                 where declined_at < now() - make_interval(days => $1::int)
                 limit 10000);

-- name: ExportUserFriendDeclines :many
-- Mine to hear, so mine to export: the asks of mine that were dismissed.
select u.display_name, d.declined_at
from friend_declines d
join users u on u.id = d.addressee_id
where d.requester_id = $1
order by d.declined_at;

-- name: ClearFriendDeclines :exec
-- A request or an acceptance between the two of them settles the pair —
-- either direction, so an old dismissal cannot resurface later.
delete from friend_declines
where (requester_id = $1 and addressee_id = $2)
   or (requester_id = $2 and addressee_id = $1);
