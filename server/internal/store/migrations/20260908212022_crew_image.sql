-- +goose Up
-- A crew's logo (#1237): one small blob on the row, like a rider's avatar is
-- one URL on theirs. Postgres, not an object store (ADR-0002: single VM), and
-- bounded by the same 2 MB the chat image reader enforces. image_set_at is
-- the cache key: the URL stays /api/crews/{id}/image and the ETag moves.
alter table crews add column image_mime text;
alter table crews add column image bytea;
alter table crews add column image_set_at timestamptz;

-- +goose Down
alter table crews drop column image_set_at;
alter table crews drop column image;
alter table crews drop column image_mime;
