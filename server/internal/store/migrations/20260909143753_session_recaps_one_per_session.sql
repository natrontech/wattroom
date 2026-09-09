-- +goose Up
-- One recap per session (ADR-0034), enforced: the keeper now retries a
-- failed write like the ride saver does (audit 2026-09-09), and a retry after
-- a lost answer must land on the row it already made. Duplicates from before
-- the rule (a keeper restarted mid-write) keep the newest.
delete from session_recaps a using session_recaps b
 where a.room_id = b.room_id and a.started_at = b.started_at and a.created_at < b.created_at;
create unique index if not exists session_recaps_one_per_session
    on session_recaps (room_id, started_at);

-- +goose Down
drop index if exists session_recaps_one_per_session;
