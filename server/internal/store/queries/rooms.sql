-- name: CreateRoom :one
insert into rooms (code, slug, name, owner_id)
values ($1, $2, $3, $4)
returning *;

-- name: GetRoomByCode :one
select * from rooms where code = $1;

-- name: GetRoomBySlug :one
select * from rooms where slug = $1;

-- name: CreateMembership :exec
insert into memberships (room_id, user_id, role)
values ($1, $2, $3)
on conflict (room_id, user_id) do nothing;

-- name: ListRoomMembers :many
select u.*, m.role
from memberships m
join users u on u.id = m.user_id
where m.room_id = $1
order by m.joined_at;

-- name: ListUserRooms :many
select r.*
from memberships m
join rooms r on r.id = m.room_id
where m.user_id = $1
order by m.joined_at desc;

-- name: GetMembership :one
select * from memberships where room_id = $1 and user_id = $2;

-- name: UpdateRoom :one
update rooms set name = $2, listed = $3 where id = $1 returning *;

-- name: UpdateMembershipRole :exec
update memberships set role = $3 where room_id = $1 and user_id = $2;

-- name: DeleteMembership :exec
delete from memberships where room_id = $1 and user_id = $2;

-- name: CountRoomMembers :one
select count(*) from memberships where room_id = $1;
