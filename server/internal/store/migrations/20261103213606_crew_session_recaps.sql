-- +goose Up
-- A crew session's recap (docs/SESSIONS.md): a session of the crew's own ran
-- in no voice channel, so its recap carries no channel gate, and every member
-- may read it. Null keeps the channel's gate: a recap whose channel was
-- deleted stays as narrow as it always was.
--
-- Add-only (ADR-0019): one nullable column the release before this one never
-- reads.
alter table session_recaps add column crew_wide boolean;

-- +goose Down
alter table session_recaps drop column if exists crew_wide;
