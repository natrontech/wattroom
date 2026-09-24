-- +goose Up
-- Temporary messages (#2644): the sender sets a timer and the line is gone
-- for everyone when it runs out. Null is a line that stays, which is every
-- line the release before this one wrote — so that release reads these
-- tables as it always did, and a rollback only stops new timers being set.
alter table chat_messages add column expires_at timestamptz;
alter table dm_messages add column expires_at timestamptz;

-- The sweep asks "what has run out?" every minute; only the few lines with a
-- timer are in these.
create index chat_messages_expiry on chat_messages (expires_at)
where expires_at is not null;
create index dm_messages_expiry on dm_messages (expires_at)
where expires_at is not null;

-- +goose Down
drop index dm_messages_expiry;
drop index chat_messages_expiry;
alter table dm_messages drop column expires_at;
alter table chat_messages drop column expires_at;
