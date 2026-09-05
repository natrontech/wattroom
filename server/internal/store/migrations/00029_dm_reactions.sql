-- +goose Up
-- DM reactions (#777, follow-up from #672): the same shape as a room's
-- chat_reactions (00012), but against dm_messages instead of chat_messages —
-- a DM has no room to scope by, and the pair on the message row is the
-- privacy boundary. A separate table, not a shared one: chat_reactions'
-- foreign key is chat_messages-specific, and a message can only ever live in
-- one of the two tables.
create table dm_reactions (
    message_id uuid not null references dm_messages (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    emoji text not null,
    primary key (message_id, user_id, emoji)
);

-- +goose Down
drop table dm_reactions;
