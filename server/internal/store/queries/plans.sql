-- name: CreatePersonalPlan :one
-- A shelf workout on a day (#4615). Inserted only when the workout is the
-- rider's own: someone else's id inserts nothing and reads as absent.
insert into personal_plans (user_id, workout_id, day)
select @user_id::uuid, w.id, @day::date
from workouts w
where w.id = @workout_id::uuid and w.owner_id = @user_id::uuid
returning id;

-- name: CountUpcomingPersonalPlans :one
-- The 100-plan ceiling, counted with the rider's row locked inside the
-- transaction that inserts (#1413's lesson).
select count(*) from personal_plans where user_id = $1 and day >= $2;

-- name: ListPersonalPlans :many
-- One rider's plans from one day through another, in day order, each with
-- the workout it names as the shelf holds it now.
select p.id, p.day, p.workout_id, w.name as workout_name, w.definition
from personal_plans p
join workouts w on w.id = p.workout_id
where p.user_id = @user_id::uuid and p.day between @from_day::date and @to_day::date
order by p.day, p.created_at, p.id;

-- name: MovePersonalPlan :execrows
update personal_plans set day = @day::date where id = @id::uuid and user_id = @user_id::uuid;

-- name: DeletePersonalPlan :execrows
delete from personal_plans where id = $1 and user_id = $2;
