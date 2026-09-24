-- +goose Up
-- A rider's status (ADR-0060, #2694): an emoji, a line, and when it clears.
-- All null is no status, which is every rider the release before this one
-- knew — so that release reads users as it always did.
--
-- `status_emoji` is what the status shows: a Unicode emoji, or a crew emoji's
-- `:name:`. `status_emoji_id` is that crew emoji's picture while it exists;
-- SET NULL when the crew deletes it, so the status falls back to the name,
-- the way chat draws a deleted emoji. The text bound is
-- protocol.MaxStatusChars, held here as a literal (limits.go says why).
--
-- Expand/contract (ADR-0019): a release only ADDS — nullable columns and an
-- index.
alter table users add column status_emoji text;
alter table users add column status_emoji_id uuid references crew_emoji (id) on delete set null;
alter table users add column status_text text check (char_length(status_text) <= 100);
alter table users add column status_expires_at timestamptz;

-- The picture's read asks "does anybody wear this?", and a crew deleting an
-- emoji sets the column null through this.
create index users_status_emoji on users (status_emoji_id)
where status_emoji_id is not null;

-- +goose Down
drop index users_status_emoji;
alter table users drop column status_expires_at;
alter table users drop column status_text;
alter table users drop column status_emoji_id;
alter table users drop column status_emoji;
