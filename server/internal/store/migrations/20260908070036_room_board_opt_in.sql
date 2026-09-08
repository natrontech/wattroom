-- +goose Up
-- The room's ordered board is opt-in and off until someone turns it on
-- (ADR-0036, #995). Being in a room must not put a rider on a board —
-- RESEARCH.md §14.8 calls enrolment by existence the first trap, and Garmin's
-- mandatory group challenges are the shipped counter-example.
--
-- Expand/contract (ADR-0019): one added column with a default, so the release
-- before this one reads every row unchanged and a rollback loses only the
-- setting. `false` is the default on purpose — a room that existed before this
-- shipped has consented to nothing.
alter table rooms add column if not exists board_enabled boolean not null default false;

-- +goose Down
alter table rooms drop column if exists board_enabled;
