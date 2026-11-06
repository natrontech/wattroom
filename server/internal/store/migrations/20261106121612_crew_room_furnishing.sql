-- +goose Up
-- What a crew has furnished its cozy room with, what it has up right now, and
-- its arcade's best scores. Expand only (ADR-0019): new tables the release
-- before this one never reads.
create table crew_room_items (
    crew_id   uuid        not null references crews (id) on delete cascade,
    item      text        not null,
    -- Who paid. Set null with the account: the rug stays in the room.
    bought_by uuid        references users (id) on delete set null,
    bought_at timestamptz not null default now(),
    primary key (crew_id, item)
);
create index crew_room_items_bought_by on crew_room_items (bought_by);

-- The item up in each slot, {"rug": "rug.forest"}. No row is the room as it
-- came. A table of its own, so `select *` on crews keeps its shape.
create table crew_rooms (
    crew_id uuid  primary key references crews (id) on delete cascade,
    picks   jsonb not null default '{}'::jsonb
);

-- One row a rider, their best: a high score table, not a log.
create table crew_arcade (
    crew_id uuid        not null references crews (id) on delete cascade,
    user_id uuid        not null references users (id) on delete cascade,
    score   integer     not null,
    set_at  timestamptz not null default now(),
    primary key (crew_id, user_id)
);
create index crew_arcade_top on crew_arcade (crew_id, score desc);
create index crew_arcade_user on crew_arcade (user_id);

-- +goose Down
drop table if exists crew_arcade;
drop table if exists crew_rooms;
drop table if exists crew_room_items;
