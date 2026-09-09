-- +goose Up
-- The invite is the crew's (ADR-0038, amended 2026-09-08, #1236): a crew has a
-- join code, crew membership is stored, and rooms are channels a crew member
-- walks into. Expand only (ADR-0019): rooms.code stays for the rollback
-- release, crews.code stays nullable until the contract half.

alter table crews add column code text;
create unique index crews_code on crews (code);

-- Every crew that exists gets a code now, in the room codes' alphabet (no
-- 0/O, 1/I/L). Correlated on the row so random() runs once per crew rather
-- than once per statement.
update crews c set code = (
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, 6)
    where c.id is not null
) where c.code is null;

-- 'member' joins the roles: membership is a row now, not a derivation.
alter table crew_roles drop constraint crew_roles_role_check;
alter table crew_roles add constraint crew_roles_role_check check (role in ('member', 'admin', 'banned'));

-- Nobody's standing changes on upgrade: everyone the derivation counted as in
-- a crew gets the row, dated from their first room in it. The owner needs no
-- row (crews.owner_id), and an admin or banned row already says more.
insert into crew_roles (crew_id, user_id, role, set_at)
select r.crew_id, m.user_id, 'member', min(m.joined_at)
from memberships m
join rooms r on r.id = m.room_id
join crews c on c.id = r.crew_id
where m.role <> 'banned' and c.owner_id <> m.user_id
group by r.crew_id, m.user_id
on conflict (crew_id, user_id) do nothing;

-- The one gate reads the row. Same columns, so every caller stands.
create or replace view visible_rooms as
with crew_membership as (
    select cr.crew_id, cr.user_id from crew_roles cr where cr.role in ('member', 'admin')
    union
    select c.id, c.owner_id from crews c
),
candidates as (
    select m.room_id, m.user_id from memberships m where m.role <> 'banned'
    union
    select r.id, cm.user_id
    from rooms r
    join crew_membership cm on cm.crew_id = r.crew_id
    where r.crew_visible
    union
    select g.room_id, g.user_id from room_grants g
)
select c.room_id, c.user_id
from candidates c
join rooms r on r.id = c.room_id
where not exists (
    select 1 from memberships b
    where b.room_id = c.room_id and b.user_id = c.user_id and b.role = 'banned'
)
and not exists (
    select 1 from crew_roles cr
    where cr.crew_id = r.crew_id and cr.user_id = c.user_id and cr.role = 'banned'
);

-- +goose Down
create or replace view visible_rooms as
with crew_membership as (
    select distinct r.crew_id, m.user_id
    from memberships m
    join rooms r on r.id = m.room_id
    where m.role <> 'banned' and r.crew_id is not null
),
candidates as (
    select m.room_id, m.user_id from memberships m where m.role <> 'banned'
    union
    select r.id, cm.user_id
    from rooms r
    join crew_membership cm on cm.crew_id = r.crew_id
    where r.crew_visible
    union
    select g.room_id, g.user_id from room_grants g
)
select c.room_id, c.user_id
from candidates c
join rooms r on r.id = c.room_id
where not exists (
    select 1 from memberships b
    where b.room_id = c.room_id and b.user_id = c.user_id and b.role = 'banned'
)
and not exists (
    select 1 from crew_roles cr
    where cr.crew_id = r.crew_id and cr.user_id = c.user_id and cr.role = 'banned'
);
delete from crew_roles where role = 'member';
alter table crew_roles drop constraint crew_roles_role_check;
alter table crew_roles add constraint crew_roles_role_check check (role in ('admin', 'banned'));
drop index crews_code;
alter table crews drop column code;
