-- +goose Up
-- Searching the music pool (#268, ADR-0015: "Postgres full-text over
-- title/artist/album plus tag facets. No search engine, no embeddings.").
--
-- A generated column rather than an expression index, so the vector is a thing
-- a query can rank by without recomputing it per row, and it stays correct
-- without a trigger anyone has to remember. Weighted A/B/C: a word in a title
-- outranks the same word in an album, which is what a rider looking for a song
-- means.
--
-- Expand/contract (ADR-0019): one generated column and one index. The release
-- before this reads every row unchanged; a rollback stops ranking.
alter table tracks add column if not exists search tsvector
    generated always as (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(artist, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(album, '')), 'C')
    ) stored;

-- 'simple' rather than 'english': a pool of song titles is full of proper
-- nouns and other languages, and stemming "Ramones" is not a service.
create index if not exists tracks_search on tracks using gin (search);

-- +goose Down
drop index if exists tracks_search;
alter table tracks drop column if exists search;
