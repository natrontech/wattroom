-- +goose Up
-- The wallet (#3152, ADR-0069): Batzen in a ledger of their own, never
-- xp_events. Append-only — a balance is the sum of its rows, and nothing is
-- ever updated or deleted but by the account's purge.
--
-- Earned rows (a ride, a ride that grew, the welcome and the opening grants,
-- a purchase undone) are never negative; a purchase always is. One row per
-- rider per source per ref: a retried save, a replayed amendment or a second
-- run of the opening job writes nothing twice.
--
-- Add-only (ADR-0019): a new table and a function the release before this one
-- never reads.
create table wallet_events (
    id         bigserial primary key,
    user_id    uuid not null references users (id) on delete cascade,
    source     text not null check (source in ('ride', 'ride_grew', 'welcome', 'opening', 'purchase', 'undo')),
    amount     integer not null,
    ref        text not null,
    created_at timestamptz not null default now(),
    check ((source = 'purchase') = (amount < 0)),
    unique (user_id, source, ref)
);

-- The day's minting, read under the rider's row lock on every save.
create index wallet_events_user_day on wallet_events (user_id, created_at);

-- +goose StatementBegin
create function user_wallet_balance(rider uuid) returns bigint
language sql stable as $$
    select coalesce(sum(amount), 0)::bigint from wallet_events where user_id = rider
$$;
-- +goose StatementEnd

-- +goose Down
drop function if exists user_wallet_balance(uuid);
drop table if exists wallet_events;
