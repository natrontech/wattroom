-- +goose Up
-- Pasted DM images (#285), mirroring chat_images for the room side (#279).
-- The pair on the row IS the read permission — a blob is readable by exactly
-- its sender and its recipient, no join needed to prove it.
create table dm_images (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references users (id) on delete cascade,
    recipient_id uuid not null references users (id) on delete cascade,
    mime text not null,
    bytes bytea not null,
    created_at timestamptz not null default now(),
    check (sender_id <> recipient_id)
);

alter table dm_messages
    add column image_id uuid references dm_images (id) on delete set null;

-- Keeps the "still referenced?" probe in the sweep from scanning the thread.
create index dm_messages_image on dm_messages (image_id)
where image_id is not null;

-- +goose Down
drop index dm_messages_image;
alter table dm_messages drop column image_id;
drop table dm_images;
