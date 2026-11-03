-- +goose Up
-- A personal token the rider marked for planning (#4207): its MCP coach may
-- also save workouts to the rider's shelf and plan sessions in the rider's
-- crews. Null is every token minted before this, and reads as read-only —
-- no existing token gains a write it was never given.
--
-- Expand/contract (ADR-0019): one nullable column, no default, no backfill;
-- the release before this one never reads it.
alter table api_tokens add column can_write boolean;

-- +goose Down
alter table api_tokens drop column if exists can_write;
