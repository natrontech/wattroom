-- +goose Up
-- Editing a sent message (#865). Expand-only (ADR-0019): one nullable column
-- per message table, so the previous release's code reads these rows
-- unchanged and a rollback to its image stays safe.
--
-- Null means "never edited" rather than a zero time, because that is the
-- question the client asks — whether to render "edited" beside the clock.
--
-- `if not exists`, and numbered past the 00036 collision (#927): a database
-- that applied this file while it was still 00036 already has the columns and
-- must not fail on them, and one that applied board_clips as 00036 never got
-- them and must still receive them. Both converge here.
alter table chat_messages add column if not exists edited_at timestamptz;
alter table dm_messages add column if not exists edited_at timestamptz;

-- +goose Down
alter table chat_messages drop column edited_at;
alter table dm_messages drop column edited_at;
