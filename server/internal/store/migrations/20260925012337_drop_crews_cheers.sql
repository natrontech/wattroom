-- +goose Up
-- The contract after #2722 (#2733, ADR-0019). The reaction set became each
-- rider's own (users.cheers) and the code stopped reading crews.cheers in
-- 2026.09.138. What kept the column was the generated SQL: sqlc had expanded
-- `*` on crews into lists that named it, in every release up to .142. #2784
-- made those lists explicit without it, and 2026.09.143 shipped that — so the
-- release a rollback lands on from here names nothing this drops.
alter table crews drop column cheers;

-- +goose Down
alter table crews add column cheers text not null default '';
