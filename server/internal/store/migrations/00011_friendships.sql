-- +goose Up
-- ADR-0012: mutual only, formed through a shared room. One row per pair;
-- the expression index refuses the mirrored duplicate.
create table friendships (
    requester_id uuid not null references users (id) on delete cascade,
    addressee_id uuid not null references users (id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'accepted')),
    created_at timestamptz not null default now(),
    primary key (requester_id, addressee_id),
    check (requester_id <> addressee_id)
);

create unique index friendships_pair on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- +goose Down
drop table friendships;
