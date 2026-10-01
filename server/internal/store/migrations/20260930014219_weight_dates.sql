-- +goose Up
-- When a rider's weight last changed, and when they last answered for it
-- (#3169, ADR-0067): a race rides a weight changed within 14 days of its flag
-- unranked, and one not confirmed within 90 days too. A change is an answer,
-- so it moves both; the commissaire's tap moves only the second. Null is
-- "never recorded": an old weight nobody has confirmed since this shipped.
--
-- Add-only (ADR-0019): two nullable columns the release before this one never
-- reads.
alter table users
    add column weight_changed_at timestamptz,
    add column weight_confirmed_at timestamptz;

-- +goose Down
alter table users
    drop column if exists weight_confirmed_at,
    drop column if exists weight_changed_at;
