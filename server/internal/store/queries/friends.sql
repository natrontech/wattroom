-- name: CreateFriendRequest :exec
insert into friendships (requester_id, addressee_id) values ($1, $2);

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
select f.status, f.requester_id, f.created_at, u.id, u.display_name, u.avatar_url, u.avatar_preset,
    user_total_xp(u.id)::bigint as total_xp
from friendships f
join users u on u.id = case when f.requester_id = $1 then f.addressee_id else f.requester_id end
where f.requester_id = $1 or f.addressee_id = $1
order by u.display_name;

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

-- name: ClearFriendDeclines :exec
-- A request or an acceptance between the two of them settles the pair —
-- either direction, so an old dismissal cannot resurface later.
delete from friend_declines
where (requester_id = $1 and addressee_id = $2)
   or (requester_id = $2 and addressee_id = $1);
