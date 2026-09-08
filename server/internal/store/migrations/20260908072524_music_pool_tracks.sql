-- +goose Up
-- The self-hosted music pool's tracks (#266, ADR-0015). Postgres holds
-- metadata only; the audio is a file on disk named for its SHA-256, so two
-- riders uploading the same song store one copy.
--
-- One row per sha256, owned by whoever uploaded it first: the ADR says
-- "duplicate uploads dedupe to one file" and this is what that means for the
-- row. A second upload of the same bytes finds this row, stores nothing, and
-- charges nobody — which is also why the quota can be a plain sum of
-- size_bytes over a user's own rows.
--
-- Expand/contract (ADR-0019): a new table only, so the release before this
-- runs unchanged and a rollback simply stops reading it.
create table if not exists tracks (
    id uuid primary key default gen_random_uuid(),
    -- The content address. Hex, lowercase; the file lives at <dir>/<ab>/<sha>.mp3.
    sha256 text not null unique,
    uploaded_by uuid not null references users(id) on delete cascade,
    -- Every field is user-editable in place: real-world ID3 tags are garbage
    -- and edit-beats-cleanup (ADR-0015).
    title text not null,
    artist text not null default '',
    album text not null default '',
    -- Measured from the file's own frames, not taken from the uploader.
    duration_ms integer not null check (duration_ms > 0),
    size_bytes integer not null check (size_bytes > 0),
    -- From the ID3 TBPM frame when it has one; null is "nobody has said".
    bpm smallint,
    created_at timestamptz not null default now()
);

-- The pool is browsed newest-first, and the quota is per uploader.
create index if not exists tracks_uploaded_by on tracks (uploaded_by);
create index if not exists tracks_created_at on tracks (created_at desc);

-- +goose Down
drop table if exists tracks;
