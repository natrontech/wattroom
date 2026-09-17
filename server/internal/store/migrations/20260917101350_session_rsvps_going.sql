-- +goose Up
-- A planned session can tell "hasn't answered" from "said no" (#1011).
--
-- Until now `session_rsvps` held one row per rider who said yes, and taking
-- an RSVP back deleted it — so "I am not coming" and "I have not looked at
-- this yet" were the same absence. A planner could not read the number that
-- changes their decision, and the hour-before reminder mailed riders who had
-- already decided not to come, because ListRoomNotifyTargets never consulted
-- this table at all.
--
-- A row is still an ANSWER and its absence is still "unanswered" — that is
-- the third state, and it needs no storage. The column says which of the two
-- answers the row is, so the shape does not change: one row per rider per
-- session, one primary key, one statement to write it.
--
-- NOT NULL DEFAULT TRUE, on the precedent of 20260908122221: every existing
-- row was somebody saying yes, so the default IS their answer, and the
-- previous release — which inserts (session_id, user_id) and names no
-- column — keeps writing "in" without knowing the column is there. A
-- nullable column would have meant inventing a meaning for NULL and reading
-- every row through a coalesce for the same result.
--
-- Expand/contract (ADR-0019): one defaulted column, nothing dropped or
-- renamed. Rolling back to the previous image loses only the distinction —
-- a decline reads as an RSVP again, which is exactly where this started.
alter table session_rsvps add column if not exists going boolean not null default true;

-- +goose Down
alter table session_rsvps drop column if exists going;
