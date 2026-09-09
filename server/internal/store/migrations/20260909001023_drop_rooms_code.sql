-- +goose Up
-- Contract half for room codes (ADR-0038 amended, #1236; ADR-0019). The
-- expand half shipped in 2026.09.57 (#1281): nothing has written or read
-- rooms.code since, so the image a rollback would retag to does not need
-- the column either. The unique constraint goes with it.
alter table rooms drop column code;

-- +goose Down
-- The codes are gone for good; a reverse can only give the column back,
-- empty and nullable, so the release before this one boots under it.
alter table rooms add column code text;
