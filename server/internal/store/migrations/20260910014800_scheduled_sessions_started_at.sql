-- +goose Up
-- A plan that was started is marked (#1905): nothing linked the running
-- session to the row, so a 20-minute session started on time ended inside
-- its own 30-minute grace and the plan re-offered itself — "Start now" live
-- beside the recap, and a coach able to start it twice. Nullable, so the
-- release before this one reads the table unchanged (ADR-0019).
alter table scheduled_sessions add column started_at timestamptz;

-- +goose Down
alter table scheduled_sessions drop column started_at;
