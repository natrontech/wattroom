-- +goose Up
-- Whether the save that wrote a ride judged its session a group session
-- (#3517). An amendment used to judge again from the rides table, with a
-- different measure and none at all for a ride saved without a session id, so
-- a group ride's growth was paid without its × 1.2. Now it reads the save's.
--
-- Add-only (ADR-0019): one nullable column. Null is a ride no session save
-- wrote, and those are paid as solo.
alter table rides add column group_session boolean;

-- +goose Down
alter table rides drop column if exists group_session;
