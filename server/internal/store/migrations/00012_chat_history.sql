-- +goose Up
-- ADR-0010 amended (#201): chat is a bounded room log, not an archive.
create table chat_messages (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null references rooms (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    text text not null,
    created_at timestamptz not null default now()
);

create index chat_messages_room_time on chat_messages (room_id, created_at desc);

create table chat_reactions (
    message_id uuid not null references chat_messages (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    emoji text not null,
    primary key (message_id, user_id, emoji)
);

-- +goose Down
drop table chat_reactions;
drop table chat_messages;
