-- +goose Up
-- One start per rider, enforced (#2064). `FindRideAt` already makes a save
-- that retries after a lost response land on the row it wrote the first time,
-- but that dedupe was application code with nothing behind it: two saves
-- racing each other both read "no row" and both insert. The /history cursor
-- now pages on (started_at, id), so no read depends on this being true —
-- what the index buys is the race itself, closed in the database.
--
-- Additive, as ADR-0019 requires: nothing drops, so the previous image runs
-- against this schema unchanged. `rides_user_started` already serves the
-- list's (user_id, started_at desc) order, so this index is the constraint
-- and not a read path.
--
-- Duplicates from before the constraint keep BOTH rides, the later ones
-- nudged forward by microseconds until every start is distinct. Deleting one
-- is the obvious alternative and it is wrong twice over: a raw delete writes
-- no offsetting `ride_deleted` ledger row, so ADR-0047's arithmetic breaks
-- and a rider's level falls on deploy; and two rows sharing a start are
-- indistinguishable from two genuine back-to-back saves, so the migration
-- would be guessing which ride happened. A microsecond is below every
-- precision the app shows or sends, so nothing a rider can see moves, and a
-- pair that really is one ride saved twice stays in /history where its owner
-- can delete it through the endpoint that keeps the ledger straight.
--
-- The loop is bounded because a nudged row can land on a start that is
-- already taken. Ten passes is far past any real history, and reaching it
-- raises instead of spinning, so a boot that cannot resolve says why.
-- +goose StatementBegin
do $$
declare
    passes int := 0;
begin
    while exists (
        select 1 from rides group by user_id, started_at having count(*) > 1
    ) loop
        passes := passes + 1;
        if passes > 10 then
            raise exception 'rides: duplicate (user_id, started_at) rows did not resolve in % passes', passes - 1;
        end if;
        update rides
           set started_at = rides.started_at + (later.n * interval '1 microsecond')
          from (
                select id,
                       (row_number() over (partition by user_id, started_at order by id))::int - 1 as n
                  from rides
               ) as later
         where later.id = rides.id and later.n > 0;
    end loop;
end $$;
-- +goose StatementEnd

create unique index if not exists rides_one_start_per_rider on rides (user_id, started_at);

-- +goose Down
drop index if exists rides_one_start_per_rider;
