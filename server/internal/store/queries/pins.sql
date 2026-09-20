-- The crew's pin board (ADR-0056, #2405). Owned by the crew, read in every
-- room of it. Every statement is scoped by crew_id, including the ones that
-- already have the pin's own id: the handler resolved the crew from the path
-- and the membership from that, so a pin id from another crew must miss
-- rather than be trusted — the rule chat.sql's edit and reaction statements
-- repeat for the same reason.

-- name: ListCrewPins :many
-- Oldest first, so a board reads in the order it was built. The id breaks a
-- same-millisecond tie, so two reads agree on the order (#468).
select p.id, p.title, p.body, p.created_by, u.display_name as created_by_name,
       p.created_at, p.updated_at
from crew_pins p
left join users u on u.id = p.created_by
where p.crew_id = $1
order by p.created_at, p.id;

-- name: CreateCrewPin :one
-- Bounded per crew (protocol.MaxCrewPins), and the bound is enforced HERE
-- rather than by a read-then-insert in the handler: two members pinning at
-- the same moment both passed a count check and both inserted, which is the
-- shape of every cap this repo has had to fix twice. `where exists` makes the
-- count and the insert one statement, and no row returned is the refusal.
insert into crew_pins (crew_id, title, body, created_by)
select @crew_id, @title, @body, @created_by
where (select count(*) from crew_pins where crew_id = @crew_id) < @max_pins::int
returning id, created_at, updated_at;

-- name: UpdateCrewPin :one
-- Anyone in the crew may rewrite any pin (ADR-0056): it is a shared board,
-- and nothing here asks who wrote it. Crew-scoped, so a pin id from another
-- crew updates nothing and the handler answers 404.
update crew_pins set title = $3, body = $4, updated_at = now()
where id = $1 and crew_id = $2
returning id, created_at, updated_at;

-- name: DeleteCrewPin :execrows
-- Crew-scoped like the update. The row count is the answer: 0 means no such
-- pin in this crew, which is a 404 and not a silent success.
delete from crew_pins where id = $1 and crew_id = $2;

