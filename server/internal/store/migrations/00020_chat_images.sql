-- +goose Up
-- Pasted chat images (#279): blobs live in Postgres and die with the bounded
-- chat log — once PruneChat drops a message, its image is unreferenced and the
-- sweep collects it. No object store (ADR-0002: single VM).
create table chat_images (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null references rooms (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    mime text not null,
    bytes bytea not null,
    created_at timestamptz not null default now()
);

alter table chat_messages
    add column image_id uuid references chat_images (id) on delete set null;

-- The prune sweep asks "is this image still referenced?" — keep that a probe,
-- not a scan.
create index chat_messages_image on chat_messages (image_id)
where image_id is not null;

-- +goose Down
drop index chat_messages_image;
alter table chat_messages drop column image_id;
drop table chat_images;
