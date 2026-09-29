-- name: CreateWalletEvent :execrows
-- One row per rider per source per ref: a retried save writes nothing twice.
insert into wallet_events (user_id, source, amount, ref)
values ($1, $2, $3, $4)
on conflict (user_id, source, ref) do nothing;

-- name: WalletMintedToday :one
-- What riding has minted for this rider in the current UTC day (#3152,
-- docs/SPEC.md "Wardrobe": the cap is per UTC day of the save). Read under
-- the rider's row lock, so two saves cannot both find room.
select coalesce(sum(amount), 0)::integer from wallet_events
where user_id = $1 and source in ('ride', 'ride_grew')
  and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');

-- name: WalletMintedForRide :one
-- What one ride has minted so far: its save and every amendment since.
select coalesce(sum(amount), 0)::integer from wallet_events
where user_id = $1 and source in ('ride', 'ride_grew')
  and (ref = sqlc.arg(ride)::text or ref like sqlc.arg(ride)::text || '@%');

-- name: WalletBalance :one
select user_wallet_balance($1)::bigint;

-- name: UserIsSynthetic :one
-- The production ride monitor (#153) rides for real and earns nothing.
select exists (
    select 1 from identities where user_id = $1 and provider = 'synthetic'
)::boolean;

-- name: ListAccountsWithoutOpening :many
-- Every account the opening job still owes its one grant (ADR-0069). The
-- synthetic account is owed nothing.
select u.id from users u
where not exists (select 1 from wallet_events w where w.user_id = u.id and w.source = 'opening')
  and not exists (select 1 from identities i where i.user_id = u.id and i.provider = 'synthetic');

-- name: OpenWallet :execrows
-- One account's opening grant (#3152): min(its history, the cap), where its
-- history is the Batzen its rides saved before the wallet would have minted —
-- a minute at the ride's own FTP, held to the per-ride ceiling — and a ride
-- the wallet already paid counts nothing. Read under the rider's row lock, so
-- a ride minting at the same moment cannot be counted twice.
insert into wallet_events (user_id, source, amount, ref)
select sqlc.arg(user_id)::uuid, 'opening',
       least(sqlc.arg(grant_cap)::integer, floor(coalesce(sum(least(
           r.kj * 1000.0 / (r.ftp_watts * 60.0),
           sqlc.arg(per_minute)::float8 * r.seconds / 60.0)), 0)))::integer,
       'opening'
from rides r
where r.user_id = sqlc.arg(user_id)::uuid and r.ftp_watts > 0
  and not exists (
      select 1 from wallet_events w
      where w.user_id = r.user_id and w.source in ('ride', 'ride_grew')
        and (w.ref = r.id::text or w.ref like r.id::text || '@%'))
on conflict (user_id, source, ref) do nothing;

-- name: ExportUserWallet :many
-- The ledger as the rider's export carries it (ADR-0053), oldest first.
select source, amount, ref, created_at from wallet_events
where user_id = sqlc.arg(user_id)
order by created_at, id
limit sqlc.arg(lim);

-- name: SessionShapeOfRide :one
-- How many rides a ride's session saved and the longest of them: whether it
-- was a group session, for the wallet's × 1.2 on an amendment (#3152). A
-- solo ride has no session and counts none.
select count(*)::integer as rides, coalesce(max(seconds), 0)::integer as longest
from rides
where session_id is not null
  and session_id = (select r.session_id from rides r where r.id = $1);
