-- +goose Up
-- Editing a sent message (#865). Expand-only (ADR-0019): one nullable column
-- per message table, so the previous release's code reads these rows
-- unchanged and a rollback to its image stays safe.
--
-- Null means "never edited" rather than a zero time, because that is the
-- question the client asks — whether to render "edited" beside the clock.
alter table chat_messages add column edited_at timestamptz;
alter table dm_messages add column edited_at timestamptz;

-- +goose Down
alter table chat_messages drop column edited_at;
alter table dm_messages drop column edited_at;
