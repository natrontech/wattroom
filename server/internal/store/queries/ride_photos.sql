-- The photos a rider took on a ride (docs/spec/riding.md "The ride's
-- pictures"). Every query is owner-scoped: someone else's ride has no photos
-- to them, the way GetRide reads it as absent.

-- name: PutRidePhoto :execrows
-- Insert or replace one view of one photo, on the rider's own ride only: a
-- ride that is not theirs inserts nothing, which the handler reads as 404.
-- A retried upload of the same (n, view) lands on itself.
insert into ride_photos (ride_id, user_id, n, view, bytes, size_bytes)
select r.id, r.user_id, @n::smallint, @view::text, @bytes::bytea, @size_bytes::integer
from rides r
where r.id = @ride_id and r.user_id = @user_id
on conflict (ride_id, n, view) do update
set bytes = excluded.bytes, size_bytes = excluded.size_bytes, created_at = now();

-- name: RiderPhotoBytes :one
-- What the rider's photos hold, less the one view about to be replaced: the
-- ceiling is on what will be kept, so a retry never counts itself twice.
select coalesce(sum(size_bytes), 0)::bigint
from ride_photos
where user_id = @user_id
  and not (ride_id = @ride_id and n = @n and view = @view);

-- name: ListRidePhotos :many
-- A ride's photos, without their bytes: the page draws each from its own URL.
select p.n, p.view, p.size_bytes, p.created_at
from ride_photos p
where p.ride_id = @ride_id and p.user_id = @user_id
order by p.n, p.view;

-- name: GetRidePhoto :one
select p.bytes, p.created_at
from ride_photos p
where p.ride_id = @ride_id and p.user_id = @user_id and p.n = @n and p.view = @view;

-- name: DeleteRidePhoto :execrows
-- Both views of one photo.
delete from ride_photos
where ride_id = @ride_id and user_id = @user_id and n = @n;

-- name: RideIsOwn :one
-- Whether the ride is the rider's, without reading its samples.
select exists (select 1 from rides where id = @ride_id and user_id = @user_id);

-- name: ExportUserRidePhotos :many
-- The account export's list of the rider's photos (#696): which ride, which
-- photo, which view, without the bytes, which the export reads one at a time.
select p.ride_id, r.started_at as ride_started_at, r.workout_name, p.n, p.view, p.size_bytes, p.created_at
from ride_photos p
join rides r on r.id = p.ride_id
where p.user_id = @user_id
order by r.started_at, p.n, p.view
limit @lim;
