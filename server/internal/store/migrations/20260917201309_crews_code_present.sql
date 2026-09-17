-- +goose Up
-- crews.code is never absent, and now the database says so (#2334, the crew
-- audit's finding 11).
--
-- The column has been nullable since 20260908204419, which added it and
-- backfilled every existing crew, because a release only ever adds
-- (ADR-0019). Every crew founded since arrives with its code in the insert:
--
--   insert into crews (name, owner_id, code, founded_by) values ($1, $2, $3, $2)
--
-- That is the half #2332 found missing for rooms.crew_id, where CreateRoom
-- named no such column and the crew arrived a statement later — so a
-- constraint there would have been broken by the previous image. Here the
-- previous image satisfies it too, eleven releases deep, and there is no
-- rollback trap.
--
-- NOT VALID is the point, not a hedge: it takes no lock on the existing rows
-- and runs no scan, so the boot this migrates on cannot fail under any data,
-- however large or however old. New and updated rows are checked from here.
-- Validating it — the scan that lets codeOf() drop its nil branch for real —
-- is #2333's visit, off the boot path.
alter table crews add constraint crews_code_present check (code is not null) not valid;

-- +goose Down
alter table crews drop constraint if exists crews_code_present;
