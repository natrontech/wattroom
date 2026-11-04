-- +goose Up
-- The rider's figure in the cozy room: one base-36 character per part, as
-- web/src/lib/lounge/look.ts reads it. Null is the look seeded from the id.
--
-- Add-only (ADR-0019): one nullable column the release before this one never
-- reads.
alter table users add column lounge_look text;

-- +goose Down
alter table users drop column if exists lounge_look;
