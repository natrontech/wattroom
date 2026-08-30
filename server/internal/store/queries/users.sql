-- name: CreateUser :one
insert into users (display_name, avatar_url, ftp_watts, weight_kg)
values ($1, $2, $3, $4)
returning *;

-- name: GetUser :one
select * from users where id = $1;

-- name: UpdateUserProfile :one
update users
set display_name = $2, ftp_watts = $3, weight_kg = $4, strava_upload = $5
where id = $1
returning *;
