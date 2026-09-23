-- +goose Up
-- A room going must not take its crew's rows with it (#2561). M9 did not copy
-- what a room held: it gave the same rows a channel and a crew and left
-- room_id on them, and room_id still cascaded. rooms.owner_id cascades from
-- users, so a former room owner deleting their account took the text
-- channel's history (everyone's lines), the crew's plans, other riders'
-- medals, the recaps, the crew's playlists and its play log — while the crew
-- passed to its successor, emptied.
--
-- Set null instead: the row keeps its channel and crew, and only the pointer
-- to a room that is gone clears. Every column here is nullable since M9, and a
-- room's playlist carries its crew since #2430, so playlists_one_owner holds
-- with room_id cleared. Constraints only — no column changes, so the release
-- before this one reads exactly what it did (ADR-0019). The columns
-- themselves go in #2433.
alter table chat_messages drop constraint chat_messages_room_id_fkey,
    add constraint chat_messages_room_id_fkey foreign key (room_id) references rooms (id) on delete set null;
alter table chat_images drop constraint chat_images_room_id_fkey,
    add constraint chat_images_room_id_fkey foreign key (room_id) references rooms (id) on delete set null;
alter table scheduled_sessions drop constraint scheduled_sessions_room_id_fkey,
    add constraint scheduled_sessions_room_id_fkey foreign key (room_id) references rooms (id) on delete set null;
alter table medals drop constraint medals_room_id_fkey,
    add constraint medals_room_id_fkey foreign key (room_id) references rooms (id) on delete set null;
alter table session_recaps drop constraint session_recaps_room_id_fkey,
    add constraint session_recaps_room_id_fkey foreign key (room_id) references rooms (id) on delete set null;
alter table playlists drop constraint playlists_room_id_fkey,
    add constraint playlists_room_id_fkey foreign key (room_id) references rooms (id) on delete set null;
alter table track_plays drop constraint track_plays_room_id_fkey,
    add constraint track_plays_room_id_fkey foreign key (room_id) references rooms (id) on delete set null;

-- +goose Down
alter table chat_messages drop constraint chat_messages_room_id_fkey,
    add constraint chat_messages_room_id_fkey foreign key (room_id) references rooms (id) on delete cascade;
alter table chat_images drop constraint chat_images_room_id_fkey,
    add constraint chat_images_room_id_fkey foreign key (room_id) references rooms (id) on delete cascade;
alter table scheduled_sessions drop constraint scheduled_sessions_room_id_fkey,
    add constraint scheduled_sessions_room_id_fkey foreign key (room_id) references rooms (id) on delete cascade;
alter table medals drop constraint medals_room_id_fkey,
    add constraint medals_room_id_fkey foreign key (room_id) references rooms (id) on delete cascade;
alter table session_recaps drop constraint session_recaps_room_id_fkey,
    add constraint session_recaps_room_id_fkey foreign key (room_id) references rooms (id) on delete cascade;
alter table playlists drop constraint playlists_room_id_fkey,
    add constraint playlists_room_id_fkey foreign key (room_id) references rooms (id) on delete cascade;
alter table track_plays drop constraint track_plays_room_id_fkey,
    add constraint track_plays_room_id_fkey foreign key (room_id) references rooms (id) on delete cascade;
