-- +goose Up
-- The saved-workout shelf is read by keyset paging now (#1414): owner, then
-- newest first, with the id breaking created_at's tie. Without this the read
-- is a sequential scan and a sort on every page — three of them for a shelf
-- of 250. Additive, as ADR-0019 requires of a release: nothing drops, so the
-- previous image still runs against this schema.
create index workouts_owner_saved on workouts (owner_id, created_at desc, id desc);

-- +goose Down
drop index workouts_owner_saved;
