-- +goose Up
-- ADR-0012 amendment (#876): a dismissed request tells the requester. The
-- friendship row is gone by then — deleting it is the dismissal — so the one
-- fact left to carry is "this ask was answered", held here until the
-- requester's client has said it out loud. Only the requester ever reads it.
create table friend_declines (
    requester_id uuid not null references users (id) on delete cascade,
    addressee_id uuid not null references users (id) on delete cascade,
    declined_at timestamptz not null default now(),
    primary key (requester_id, addressee_id),
    check (requester_id <> addressee_id)
);

-- +goose Down
drop table friend_declines;
