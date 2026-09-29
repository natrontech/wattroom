-- Who a change concerns (#2324): the riders whose lobby sockets a presence
-- ping should reach, and nobody else. internal/audience composes these.

-- name: CrewAudience :many
-- A crew's own change: its owner, its admins and its members. Not a banned
-- rider — the crew is off their screen; a ban names them itself.
select c.owner_id as user_id from crews c where c.id = @crew_id::uuid
union
select r.user_id from crew_roles r
where r.crew_id = @crew_id::uuid and r.role in ('member', 'admin');

-- name: FriendsOf :many
-- The accepted friends of any of these riders — who sees them on a friends
-- list (ADR-0012). A hidden pair is not (#3202): neither lists the other.
select (case when f.requester_id = any(@riders::uuid[]) then f.addressee_id
             else f.requester_id end)::uuid as user_id
from friendships f
where f.status = 'accepted'
  and (f.requester_id = any(@riders::uuid[]) or f.addressee_id = any(@riders::uuid[]))
  and not rider_hidden(f.requester_id, f.addressee_id);

-- name: CrewmatesOf :many
-- Everyone in any crew this rider is in, owner or member.
with mine as (
    select c.id from crews c where c.owner_id = @rider::uuid
    union
    select r.crew_id from crew_roles r
    where r.user_id = @rider::uuid and r.role in ('member', 'admin')
)
select c.owner_id as user_id from crews c where c.id in (select id from mine)
union
select r.user_id from crew_roles r
where r.crew_id in (select id from mine) and r.role in ('member', 'admin');
