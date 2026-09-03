-- +goose Up
-- The self-hosted music pool (#266, ADR-0015). Postgres holds metadata only:
-- the audio lives on the VM disk, content-addressed by SHA-256, so two riders
-- uploading the same file share one blob. Expand-only (ADR-0019).
create table tracks (
    id uuid primary key default gen_random_uuid(),
    -- The content address. Unique: one row per distinct file, which is what
    -- makes a re-upload a no-op instead of a second copy of the same song.
    sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
    -- Whoever put it in the pool: the only account that may edit or delete it,
    -- and the account its bytes count against for the quota. Nulled rather
    -- than cascaded when that account goes — the crew's library is not one
    -- rider's property, and re-uploading it all would be the alternative.
    uploader_id uuid references users (id) on delete set null,
    size_bytes bigint not null check (size_bytes > 0),
    -- Measured by the uploading browser's audio.duration: the server never
    -- decodes audio (ADR-0015 — no ffmpeg in the image).
    duration_sec integer not null check (duration_sec > 0),
    -- ID3 at upload, every field editable afterwards: real-world tags are
    -- garbage and edit beats cleanup (ADR-0015).
    title text not null check (title <> ''),
    artist text not null default '',
    album text not null default '',
    -- Free-form, not a taxonomy — genre lives here too.
    tags text[] not null default '{}',
    -- Both optional: year is unknown in plenty of tags, and BPM only arrives
    -- from a TBPM frame or by hand (no beat detection, ADR-0015).
    year integer check (year is null or (year between 1000 and 3000)),
    bpm integer check (bpm is null or (bpm between 1 and 400)),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- The quota sum ("how much has this rider uploaded?") runs on every upload.
create index tracks_uploader on tracks (uploader_id);
-- The pool browses newest-first.
create index tracks_created on tracks (created_at desc);

-- Playlists are user-owned and visible to every signed-in member — it is a
-- crew app, sharing is the point (ADR-0015). The tables land with the pool;
-- the endpoints and the UI that fill them are #268.
create table playlists (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references users (id) on delete cascade,
    name text not null check (name <> ''),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index playlists_owner on playlists (owner_id);

create table playlist_tracks (
    playlist_id uuid not null references playlists (id) on delete cascade,
    track_id uuid not null references tracks (id) on delete cascade,
    -- Playlists are ordered, and a track may repeat in one: position is the
    -- identity of the entry, not the track.
    position integer not null check (position >= 0),
    primary key (playlist_id, position)
);

create index playlist_tracks_track on playlist_tracks (track_id);

-- +goose Down
drop table playlist_tracks;
drop table playlists;
drop table tracks;
