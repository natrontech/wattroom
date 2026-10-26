-- +goose Up
-- The name a rider gives a finished ride (#4209), beside the workout it rode.
-- workout_name stays what was ridden: Against your best groups a rider's rides
-- by it, and a crew, a session, MCP (ADR-0063) and an uploaded Strava
-- activity keep reading it. title is only what the rider's own pages, a
-- friend's view of a shared ride and the ride card call the ride; null is
-- the normal state and reads as the workout's name.
--
-- No length CHECK, as with `note`: docs/SPEC.md's 1–80 for a workout name is
-- counted in RUNES at the boundary (protocol.MaxWorkoutNameChars), and a
-- char_length CHECK would be a second answer to the same question.
--
-- Expand/contract (ADR-0019): one nullable column, no default, no backfill;
-- the release before this one never reads it.
alter table rides add column title text;

-- +goose Down
alter table rides drop column if exists title;
