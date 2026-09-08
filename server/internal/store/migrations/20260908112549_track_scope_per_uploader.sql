-- +goose Up
-- A track row belongs to whoever uploaded it (#1095, Phase 1). Until now the
-- pool was one library shared with every logged-in user of the instance —
-- deliberate in ADR-0015 while one instance meant one crew, and a hole the
-- moment wattroom.ch carries crews who do not know each other.
--
-- The whole of Phase 1 is this: a row is identified by (uploader, content)
-- rather than by content alone. `uploaded_by` already existed and already
-- meant the right thing; what was wrong was that the global unique let only
-- ONE row exist per song, so the second person to upload a track got handed
-- somebody else's row and never had one of their own. Scoping the reads
-- without this would have made their own upload invisible to them.
--
-- The FILE is not scoped and must not be: one blob per sha256 on disk however
-- many people hold it. Privacy is what you can see, not how many times the
-- bytes are stored — and the deletion path is refcounted to match (a blob
-- goes only with the last row that points at it).
--
-- Expand/contract (ADR-0019). Nothing is dropped that holds data and no
-- column changes, so the previous release runs unchanged against this schema:
-- its inserts always set `uploaded_by`, so the new unique is satisfiable, and
-- its `TrackBySha` still finds a row for any sha it wrote itself. What a
-- rollback loses is the isolation — duplicate shas can exist by then, and the
-- old single-row `TrackBySha` will return an arbitrary one of them, which is
-- exactly the shared-pool behaviour being rolled back TO. That is the honest
-- position: rolling back a scoping fix un-scopes the pool. Nothing breaks,
-- nothing is lost, and no data has to be repaired going forward again.
--
-- No backfill: the old global unique made two rows sharing (uploaded_by,
-- sha256) impossible, so every existing row already satisfies the new one.
alter table tracks drop constraint if exists tracks_sha256_key;
alter table tracks add constraint tracks_uploader_sha_key unique (uploaded_by, sha256);

-- Reads are now "this uploader's shelf", and the pool is browsed newest-first
-- within it. The old tracks_uploaded_by index is a prefix of this one.
create index if not exists tracks_uploaded_by_created on tracks (uploaded_by, created_at desc);

-- The blob refcount: "who else holds this content" is asked on every delete.
create index if not exists tracks_sha256 on tracks (sha256);

-- +goose Down
-- Narrowing back to one row per sha would have to discard rows. Refuse rather
-- than choose whose copy survives: a down migration that silently deletes a
-- rider's track is worse than one that does not run.
alter table tracks drop constraint if exists tracks_uploader_sha_key;
drop index if exists tracks_sha256;
drop index if exists tracks_uploaded_by_created;
