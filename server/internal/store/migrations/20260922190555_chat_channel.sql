-- +goose Up
-- Chat moves from the room to the text channel it became (ADR-0058, #2429):
-- its messages, their images, the read marks behind the unread counts, and
-- the one announcement a room could carry (ADR-0057). Everything goes through
-- `room_channels`, the map #2428 left, to the room's TEXT channel — a voice
-- channel has no text of its own.
--
-- Expand only (ADR-0019). `room_id` stays on every row and stays written by
-- the release before this one; #2433 drops it the release after M9. What this
-- does relax is `room_id`'s NOT NULL on the two chat tables, and that is an
-- expand too: the previous release always sets it, so nothing it writes can
-- fail, while a channel made after this migration has no room at all and its
-- first message would otherwise be unwritable. A check keeps every row
-- attached to one or the other, so the relaxation cannot leave an orphan.

alter table chat_messages
    -- Cascade: deleting a text channel takes its chat, as deleting a room did.
    add column channel_id uuid references channels (id) on delete cascade,
    alter column room_id drop not null,
    add constraint chat_messages_room_or_channel check (room_id is not null or channel_id is not null);

alter table chat_images
    add column channel_id uuid references channels (id) on delete cascade,
    alter column room_id drop not null,
    add constraint chat_images_room_or_channel check (room_id is not null or channel_id is not null);

-- The successor of `room_reads`: when a rider last read a text channel, which
-- is what an unread count is counted from.
create table channel_reads (
    channel_id uuid not null references channels (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    read_at    timestamptz not null default now(),
    primary key (channel_id, user_id)
);

-- One announcement per text channel (ADR-0057 as amended by ADR-0058): the
-- same pointer `rooms.announcement_id` is, on the channel the room's chat
-- moved to. Set null for the reason the room's column gives — PruneChat keeps
-- the marked line, so this should never fire, and if it does the channel loses
-- its notice rather than pointing at nothing.
alter table channels
    add column announcement_id uuid references chat_messages (id) on delete set null;

-- Backfill. Every statement only touches rows still without a channel, so a
-- later migration can repeat it word for word for chat a rolled-back release
-- wrote in between.
update chat_messages m
set channel_id = rc.text_channel_id
from room_channels rc
where rc.room_id = m.room_id and m.channel_id is null and rc.text_channel_id is not null;

update chat_images i
set channel_id = rc.text_channel_id
from room_channels rc
where rc.room_id = i.room_id and i.channel_id is null and rc.text_channel_id is not null;

insert into channel_reads (channel_id, user_id, read_at)
select rc.text_channel_id, r.user_id, r.read_at
from room_reads r
join room_channels rc on rc.room_id = r.room_id
where rc.text_channel_id is not null
on conflict (channel_id, user_id) do nothing;

update channels c
set announcement_id = r.announcement_id
from room_channels rc
join rooms r on r.id = rc.room_id
where c.id = rc.text_channel_id and r.announcement_id is not null and c.announcement_id is null;

-- The channel's log, newest first — the room's index, re-keyed.
create index chat_messages_channel_time on chat_messages (channel_id, created_at desc);

-- +goose Down
-- `room_id`'s NOT NULL is not put back: a message written to a channel made
-- after the Up has no room, and forcing one would fail the Down on it.
drop index chat_messages_channel_time;
alter table channels drop column announcement_id;
drop table channel_reads;
alter table chat_images
    drop constraint chat_images_room_or_channel,
    drop column channel_id;
alter table chat_messages
    drop constraint chat_messages_room_or_channel,
    drop column channel_id;
