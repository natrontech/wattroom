-- +goose Up
-- Hide this rider (#3202, ADR-0012 amended 2026-09-29): a block that works
-- both ways. One row per (blocker, blocked); the blocker's own list, never
-- shown to the blocked rider. Deleting either account takes the row along.
--
-- The release before this one never reads the table or the two functions,
-- so a rollback only lets hidden riders reach each other again.
create table rider_blocks (
    blocker_id uuid not null references users (id) on delete cascade,
    blocked_id uuid not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);
create index rider_blocks_blocked on rider_blocks (blocked_id);

-- Either of the two has hidden the other. Every friendship gate — a DM, a
-- poke, a picture, a thread head, an acceptance — asks this beside its own
-- question, so a hidden pair falls through the very branch a closed thread
-- does.
-- +goose StatementBegin
create function rider_hidden(a uuid, b uuid) returns boolean
language sql stable as $$
    select exists (
        select 1 from rider_blocks
        where (blocker_id = a and blocked_id = b)
           or (blocker_id = b and blocked_id = a)
    )
$$;
-- +goose StatementEnd

-- Whether `viewer` sees this friendship row. A hidden pair's row is gone
-- from both sides — the blocked rider reads it as an unfriending, which is
-- silent already — except the blocked rider's own ask, which stays pending
-- in front of them: they are never told (#3202).
-- +goose StatementBegin
create function friendship_visible(requester uuid, addressee uuid, status text, viewer uuid)
returns boolean
language sql stable as $$
    select not rider_hidden(requester, addressee)
        or (status = 'pending' and requester = viewer and not exists (
            select 1 from rider_blocks
            where blocker_id = viewer and blocked_id = addressee
        ))
$$;
-- +goose StatementEnd

-- +goose Down
drop function friendship_visible(uuid, uuid, text, uuid);
drop function rider_hidden(uuid, uuid);
drop table rider_blocks;
