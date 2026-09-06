-- +goose Up
-- The hour-before reminder (#841). Nullable and additive, so the release that
-- adds it can be rolled back to the one before by image tag alone (ADR-0019).
--
-- This column is what makes "exactly once" survive a restart, a tick that
-- fires twice and a second instance: the claim query sets it in the same
-- UPDATE that returns the row, so a session can only ever leave that query
-- once. Null means not yet reminded, which is also the right answer for every
-- session that already existed when this migration ran — the window is an hour
-- wide, so nothing old is ever eligible.
alter table scheduled_sessions
    add column reminded_at timestamptz;

-- +goose Down
alter table scheduled_sessions
    drop column reminded_at;
