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
    (select coalesce(sum(xp), 0) from rides r where r.user_id = u.id)::bigint as total_xp
from friendships f
join users u on u.id = case when f.requester_id = $1 then f.addressee_id else f.requester_id end
where f.requester_id = $1 or f.addressee_id = $1
order by u.display_name;

-- name: ListFriendCandidates :many
-- People I share a room with (ADR-0012's only formation path), minus me and
-- minus anyone I already have a row with.
select distinct u.id, u.display_name
from memberships mine
join memberships theirs on theirs.room_id = mine.room_id and theirs.user_id <> mine.user_id
join users u on u.id = theirs.user_id
where mine.user_id = $1
  and not exists (
    select 1 from friendships f
    where (f.requester_id = $1 and f.addressee_id = u.id)
       or (f.requester_id = u.id and f.addressee_id = $1)
  )
order by u.display_name;

-- name: CountSharedRooms :one
-- The formation gate: a request is valid only between roommates.
select count(*) from memberships a
join memberships b on b.room_id = a.room_id
where a.user_id = $1 and b.user_id = $2;
