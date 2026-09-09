-- name: CreateWorkout :one
insert into workouts (owner_id, name, author, definition)
values ($1, $2, $3, $4)
returning *;

-- name: ListUserWorkouts :many
-- Bounded read (#1416); the per-account ceiling itself is #1414's decision.
select * from workouts where owner_id = $1 order by created_at desc limit 1000;

-- name: UpdateWorkout :one
update workouts set name = $3, author = $4, definition = $5
where id = $1 and owner_id = $2 returning *;

-- name: DeleteWorkout :execrows
delete from workouts where id = $1 and owner_id = $2;
