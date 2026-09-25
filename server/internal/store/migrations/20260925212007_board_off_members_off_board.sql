-- +goose Up
-- A rider who joined a crew whose board was off was told "Joining shows
-- nobody your numbers", and still got on_board = true from the column default,
-- so the day an admin turned the board on, they were ranked without ever being
-- asked (#2820, ADR-0036's "enrolment by existence"). JoinCrew now writes the
-- door's answer; this brings the members who already came in that way into
-- line with it.
--
-- Only crews whose board is off today: nothing anybody can see changes, and a
-- member of a crew with a board on stays exactly where they are. The rows
-- cannot tell a default from a rider who switched themselves on while the
-- board was off, so both go off — the narrow side, and the switch on the
-- Members page puts a rider back in one tap.
--
-- Data only (ADR-0019): no column moves, and the release before this one reads
-- these rows as it always did.
update crew_roles cr
set on_board = false
from crews c
where c.id = cr.crew_id
  and not c.board_enabled
  and cr.role in ('member', 'admin')
  and cr.on_board;

-- +goose Down
-- Nothing to undo: which rows were defaults and which were answers was never
-- stored.
