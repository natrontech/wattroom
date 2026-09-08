-- +goose Up
-- Free-form tags on a pool track (#268, ADR-0015: "Genre/style are free-form
-- tags, not a taxonomy", and "full-text over title/artist/album plus tag
-- facets").
--
-- An array column rather than a `tags` table and a join: a tag with no
-- taxonomy has no identity — nothing renames one, nothing describes one, and
-- two riders typing "italo disco" mean the same tag because the string is the
-- same. The row is the whole fact, so a join table would only add two writes
-- and a delete cascade to store it.
--
-- Expand/contract (ADR-0019): one nullable-in-effect column with a default and
-- one index. The release before this writes rows without it and reads every
-- row unchanged; a rollback stops filtering.
alter table tracks add column if not exists tags text[] not null default '{}';

-- The facet query counts over `unnest(tags)` and the filter asks `= any(tags)`;
-- GIN is the index that answers the second one.
create index if not exists tracks_tags on tracks using gin (tags);

-- +goose Down
drop index if exists tracks_tags;
alter table tracks drop column if exists tags;
