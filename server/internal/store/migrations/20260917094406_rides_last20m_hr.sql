-- +goose Up
-- The average heart rate over a ride's LAST 20 minutes (#1620) — Friel's
-- 30-minute field test, the measurement docs/SPEC.md's LTHR-from-a-ride
-- suggestion reads. It cannot come out of the `curve` jsonb: that holds
-- best5s/best1m/best5m/best20m, which are BEST-of-window, not LAST-window,
-- and the two are different numbers on every ride that was not a time trial.
--
-- 0 is not "unknown": it means computed, and this ride has no last-20-minute
-- heart rate — shorter than 20 minutes, or the strap recorded nothing in the
-- window. Unlike norm_watts, where a real NormPower of 0 W collided with the
-- readers' fallbacks (#2253), 0 bpm is not a heart rate anybody rides at, so
-- one sentinel carries "no number" safely. Every reader asks `> 0`. NULL, and
-- only NULL, means the backfill has not reached this row yet.
--
-- Expand/contract (ADR-0019): a release only ADDS — nullable, no default, no
-- rewrite of the table. Existing rides are filled by the boot backfill in
-- internal/stats, which reads each sample blob exactly once.
-- No CHECK: the sane band for a heart rate is a PRODUCT number (docs/SPEC.md's
-- LTHR bounds, 100-210 bpm) and it belongs where the suggestion is made, not
-- on a column that records what a strap actually reported. A stored reading
-- outside the band simply never becomes a suggestion.
alter table rides add column last20m_hr smallint;

-- +goose Down
alter table rides drop column last20m_hr;
