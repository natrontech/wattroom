-- +goose Up
-- ADR-0012 amended (#208): DMs between accepted friends, bounded like room chat.
create table dm_messages (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references users (id) on delete cascade,
    recipient_id uuid not null references users (id) on delete cascade,
    text text not null,
    created_at timestamptz not null default now(),
    check (sender_id <> recipient_id)
);

create index dm_messages_pair_time on dm_messages (
    least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc
);

-- +goose Down
drop table dm_messages;
