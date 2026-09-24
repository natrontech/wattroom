-- +goose Up
-- When a rider last read each direct-message conversation (#2711, ADR-0012
-- amended 2026-09-24): the same cursor `channel_reads` is for a text channel,
-- so reading on the phone clears the dot on the desktop. It used to be a
-- localStorage stamp per browser. Only the reader's own reads ever come back
-- out of this table — the peer is never told (no read receipts).
--
-- The release before this one never reads the table, so a rollback only puts
-- the dots back on each browser's own stamp.
create table dm_reads (
    user_id uuid not null references users (id) on delete cascade,
    peer_id uuid not null references users (id) on delete cascade,
    read_at timestamptz not null default now(),
    primary key (user_id, peer_id)
);

-- Every conversation that already exists starts read. The stamps that knew
-- better are in browsers the server cannot see, and a missing row would
-- light up every DM a rider ever had; this costs at most the few that were
-- genuinely unread at the upgrade, which are still at the top of the list.
insert into dm_reads (user_id, peer_id)
select distinct recipient_id, sender_id from dm_messages
on conflict do nothing;

-- +goose Down
drop table dm_reads;
