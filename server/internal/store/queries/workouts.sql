-- name: CreateWorkout :one
insert into workouts (owner_id, name, author, definition)
values ($1, $2, $3, $4)
returning *;

-- name: ListLibraryWorkouts :many
select * from workouts where owner_id is null order by name;

-- name: ListUserWorkouts :many
select * from workouts where owner_id = $1 order by created_at desc;

-- name: UpdateWorkout :one
update workouts set name = $3, author = $4, definition = $5
where id = $1 and owner_id = $2 returning *;

-- name: DeleteWorkout :execrows
delete from workouts where id = $1 and owner_id = $2;
