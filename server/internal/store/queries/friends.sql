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
-- ride along for the friend rows' avatars (#253).
select f.status, f.requester_id, u.id, u.display_name, u.avatar_url, u.avatar_preset,
    user_total_xp(u.id)::bigint as total_xp
from friendships f
join users u on u.id = case when f.requester_id = $1 then f.addressee_id else f.requester_id end
where f.requester_id = $1 or f.addressee_id = $1
order by u.display_name;

-- name: GetUserByFriendCode :one
-- The formation gate (ADR-0012 amendment): knowing the code IS the permission
-- to ask.
select * from users where friend_code = $1;
