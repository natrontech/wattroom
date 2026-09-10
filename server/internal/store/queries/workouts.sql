-- name: CreateWorkout :one
insert into workouts (owner_id, name, author, definition)
values ($1, $2, $3, $4)
returning *;

-- name: CountUserWorkouts :one
-- docs/SPEC.md's 200-workout ceiling (#1414). Called with the rider's row
-- locked, inside the transaction that inserts — the same shape the owned-room
-- cap needed (#1413), because a count followed by an unsynchronised insert is
-- not a ceiling, it is a suggestion a burst ignores.
select count(*) from workouts where owner_id = $1;

-- name: ListUserWorkouts :many
-- Paged by save time (#1414), the `before` cursor ListUserRides uses: the
-- oldest row the caller holds, null for the first page. The read used to stop
-- at a flat `limit 1000` (#1416), which is the failure this issue is actually
-- about — workout 1001 was gone with nothing said. A ceiling is not what
-- keeps a read small; paging is.
--
-- The cursor carries the id as well, and the order breaks its tie on the id:
-- created_at defaults to now(), which is the transaction's clock and not
-- unique, so rows saved in one transaction share it exactly. A cursor on the
-- timestamp alone would step over every one of them at a page boundary —
-- silently, which is the bug this query exists to stop making.
select * from workouts
where owner_id = $1
  and (sqlc.narg('before')::timestamptz is null
       or (created_at, id) < (sqlc.narg('before')::timestamptz, sqlc.narg('before_id')::uuid))
order by created_at desc, id desc
limit $2;

-- name: UpdateWorkout :one
update workouts set name = $3, author = $4, definition = $5
where id = $1 and owner_id = $2 returning *;

-- name: DeleteWorkout :execrows
delete from workouts where id = $1 and owner_id = $2;
