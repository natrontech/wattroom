-- +goose Up
-- The XP uploaded rides minted today, per rider (#3044, docs/SPEC.md's XP
-- sources): POST /api/rides trusts the samples it is sent, so what it can
-- pay out in a UTC save day has a ceiling. One row per rider holding only
-- the current day's total — a save on a new day starts it again — so the
-- table never outgrows its riders. Deleting a ride leaves the row alone:
-- that is what bounds delete-and-repost, which ADR-0047's offset otherwise
-- pays for in full.
--
-- Nothing reads it but the save it bounds. Add-only (ADR-0019): the release
-- before this one never touches it, so a rollback leaves it behind unread.
create table ride_upload_xp (
    user_id uuid primary key references users (id) on delete cascade,
    day     date    not null,
    xp      integer not null check (xp >= 0)
);

-- +goose Down
drop table if exists ride_upload_xp;
