-- name: HideRider :one
-- False: there is no such rider. Hiding twice is hiding once — the first
-- row's time stands. Checked rather than left to the foreign key, so a
-- stale id is an answer and not an ERROR in Postgres's log (#2685).
with target as (select id from users where id = @blocked::uuid),
hidden as (
    insert into rider_blocks (blocker_id, blocked_id)
    select @blocker::uuid, id from target
    on conflict do nothing
)
select exists (select 1 from target);

-- name: UnhideRider :execrows
delete from rider_blocks where blocker_id = $1 and blocked_id = $2;

-- name: ListHiddenRiders :many
-- The blocker's own list (Settings → Hidden riders), newest first. Never the
-- other direction: who hid you is not yours to read.
select u.id, u.display_name, u.avatar_url, b.created_at
from rider_blocks b
join users u on u.id = b.blocked_id
where b.blocker_id = $1
order by b.created_at desc
limit 1000; -- an engineering bound (#1416), far past anyone's list

-- name: HiddenBetween :one
-- Which way a pair is hidden, from `viewer`'s side: whether they hid the
-- other, and whether the other hid them. The second is only ever acted on,
-- never said.
select exists (select 1 from rider_blocks v where v.blocker_id = @viewer::uuid and v.blocked_id = @other::uuid) as viewer_hid,
       exists (select 1 from rider_blocks o where o.blocker_id = @other::uuid and o.blocked_id = @viewer::uuid) as other_hid;

-- name: ListAllHiddenPairs :many
-- Every block, for the hub's in-memory copy at boot: cheers and pokes are
-- sorted per socket on the tick, where a query per frame is not an option.
select blocker_id, blocked_id from rider_blocks;

-- name: ExportUserHiddenRiders :many
-- Mine to see in Settings, so mine to export — by name, like friends.json.
select u.display_name, b.created_at
from rider_blocks b
join users u on u.id = b.blocked_id
where b.blocker_id = $1
order by b.created_at;
