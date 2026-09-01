-- +goose Up
-- The rail's unread badge (#389). ADR-0020 makes the sidebar the crew's radar,
-- and "nothing signals a room you are not looking at" was the gap it names —
-- the single strongest reason a chat app stays open in a background window.
--
-- One stamp per rider per room, not a counter: the count is derived from
-- chat_messages, so it cannot drift out of step with the log it describes.
-- Expand-only (ADR-0019): a new table, nothing dropped or renamed.
create table room_reads (
    room_id uuid not null references rooms (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    read_at timestamptz not null default now(),
    primary key (room_id, user_id)
);

-- +goose Down
drop table room_reads;
