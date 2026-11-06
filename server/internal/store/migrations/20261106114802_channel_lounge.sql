-- +goose Up
-- The lounge a voice channel keeps (ADR-0094): its lamp, weather, stove, mood,
-- radio and how often the cat was petted, as protocol.LoungeState writes them.
-- Null is a room nobody has touched. Paint, read back whole, and never queried
-- into, so jsonb on the channel rather than a table of its own.
--
-- Expand only (ADR-0019): a nullable column the release before this one never
-- reads.
alter table channels add column lounge jsonb;

-- +goose Down
alter table channels drop column if exists lounge;
