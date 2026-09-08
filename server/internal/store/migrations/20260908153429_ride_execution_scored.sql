-- +goose Up
-- Whether the ride's workout had anything to score (#1143). `execution` is
-- `real not null`, so there is no value in its range that means "no score" —
-- 0 reads as "executed none of it", which is a real and different answer.
--
-- A workout of only warmup, cooldown and sprints prescribes no target at all
-- (workout.TargetAt scores a steady step and nothing else). Execution used to
-- report 1.0 for those rides — a perfect score nobody could have earned — and
-- it was stored, paid as the execution XP bonus, and won the Metronome medal.
--
-- Expand/contract (ADR-0019): one added column with a default, so the previous
-- release reads every row unchanged and a rollback loses only the distinction
-- between "scored zero" and "nothing to score". `true` is the right default
-- because every row that exists was written by code that only ever saved
-- scorable rides' scores as meaningful.
alter table rides add column execution_scored boolean not null default true;

-- +goose Down
alter table rides drop column execution_scored;
