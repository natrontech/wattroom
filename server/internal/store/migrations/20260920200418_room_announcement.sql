-- +goose Up
-- The room's announcement (ADR-0057, #2408): one line from a coach that
-- outlasts the moment — no session Thursday, the route changed, bring a spare
-- tube.
--
-- It is a CHAT MESSAGE A COACH MARKED, not a second kind of content. The room
-- already has the log, the composer, room_reads and the unread counts, and an
-- announcement wants all four and none of them differently — so this is a
-- pointer at a line that already exists rather than a table of its own with
-- its own author, its own timestamps and its own retention to keep in step.
--
-- On the ROOM, not on the message, and that is what makes "one at a time"
-- structural: marking a new one is an UPDATE of this column, so a room cannot
-- accumulate notices nobody remembers posting. It is also how a coach retracts
-- a wrong one without a second control.
--
-- ON DELETE SET NULL is a safety net that should never fire: PruneChat is
-- amended in the same release to keep the marked line past the 500-message cap
-- (ADR-0010's bound), so the message outlives its neighbours for as long as it
-- is the announcement. If it somehow goes anyway, the room loses its notice
-- rather than pointing at a row that is not there.
--
-- Expand/contract (ADR-0019): a release only ADDS — one nullable column, no
-- default, no backfill, no table rewrite.
alter table rooms
    add column announcement_id uuid references chat_messages (id) on delete set null;

-- +goose Down
alter table rooms drop column announcement_id;
