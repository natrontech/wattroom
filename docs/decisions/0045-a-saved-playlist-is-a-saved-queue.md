# 0045 — A saved playlist is a saved queue

- Status: accepted
- Date: 2026-09-09
- Extends: [ADR-0026](0026-a-playlist-is-one-queue-entry.md) (a pasted YouTube playlist is one queue entry) and [ADR-0028](0028-room-and-personal-playlists.md) (room and personal playlists, autoplay)
- Amends: [ADR-0015](0015-self-hosted-music-pool.md)'s "when a playlist can hold a pool track" paragraph — it can now, and the scope rule is written here
- Answers: [#655](https://github.com/natrontech/wattroom/issues/655), decided by the maintainer on 2026-09-09; part of the jukebox rethink [#1419](https://github.com/natrontech/wattroom/issues/1419)

## Context

Saved playlists shipped (#627) holding YouTube ids only, a month before the
music library existed. `playlist_tracks` had a `video_id` and no `track_id`,
so a rider could save a video into a playlist and could not save their own
uploaded MP3 — the one thing "a playlist of my own music" means.

#655 asked how the two should relate and held open two answers. One table,
where an entry is either a video or a library track. Two objects, keeping
today's YouTube-only playlists and adding separate _library playlists_ on
their own tables, which the maintainer's first position favoured on
referential-integrity grounds: a video id is opaque text with no foreign key
possible, a track id is a UUID this instance owns with a real cascade, and a
table whose foreign key only sometimes means anything looked worse than two.

Meanwhile the word _playlist_ already carried three meanings (SPEC glossary):
the pasted YouTube kind, the saved room or personal kind, and ADR-0015's
never-built library kind. The jukebox rethink found that the missing thread
through the whole feature was exactly this — capability depended on where
the music came from — and a fourth object would have widened it.

## Decision

**A saved playlist is a saved queue.** Its entries are exactly what a
`JukeboxEntry` already is: a video, a pasted YouTube playlist, or a library
track. There is one playlist object, room-owned or rider-owned as ADR-0028
decided, and there is no separate library playlist. ADR-0015's third kind is
retired unbuilt.

`playlist_tracks` gains a nullable `track_id uuid references tracks on delete
cascade` beside `video_id`, with a check that exactly one of the two is set.
The cascade firing for half the rows is the behaviour wanted, and it is the
answer to the integrity argument: a deleted MP3 leaves every playlist it was
in, because the file is gone; a YouTube video cannot be deleted by us and
stays a plain id, because it was never ours. Two tables would have encoded
the same asymmetry as two UI kinds.

A library entry reads its title and artist off the track at list time. Both
are editable on the Music page, and a playlist says what the library says
today, not what it said when the row was saved.

**Queueing a playlist replays its entries as the adds that produced them**,
unchanged: a library entry replays as the library add the Music page sends.
Autoplay reads the same replay, so Ordered and Shuffled walk library tracks
from the day this lands; [#1429](https://github.com/natrontech/wattroom/issues/1429)
folds Smart into the same source.

**Scope.** Saving into a playlist requires the track to be the caller's own —
browsing is uploader-only ([ADR-0015](0015-self-hosted-music-pool.md) as
amended by #1095), so a track you cannot see is one you cannot save; the
refusal says the track is not in your library. Hearing a saved entry is
governed where hearing always was: the audio door asks, per fetch, whether
this rider may enter a room with the uploader (#1103). A playlist is not a
way around who may hear a shelf; it is a list of pointers, and each pointer
is checked when it is followed. A rider who cannot reach a track gets the
dead-track handling of #1132 — the deck moves on — rather than a silent hole.

**The word.** _Playlist_ keeps its two remaining meanings: the pasted
YouTube kind (one queue entry, ADR-0026) and the saved kind (this). The UI
never has to say "playlist" for the pasted kind — it is labelled by its own
title and track count — so a rider reading _playlist_ on screen reads the
saved kind.

## Consequences

- "Save up next as a playlist" and "Add to playlist" on a queue row or a
  library row are one call each ([#1427](https://github.com/natrontech/wattroom/issues/1427)):
  the shapes already match.
- The playlist row's add field is the room's own add box — search your
  library or paste a link — pointed at the list instead of the deck. One
  field, everywhere music is added.
- Reordering a saved playlist mirrors the queue's move ([#1428](https://github.com/natrontech/wattroom/issues/1428)).
- Expand-only (ADR-0019): one nullable column, one partial index, a check
  every existing row already satisfies. The previous release never writes
  `track_id` and reads the rest unchanged.
- Rider-visible: `SavedTrack` and the playlist JSON carry `trackId` and
  `artist`; `commandsFromTracks` emits a `trackId` add. Nothing on the wire
  protocol changes — the live queue already held all three shapes.
- Revisit only if a fourth kind of entry appears that a `JukeboxEntry` cannot
  express; then the queue changes first and the playlist follows it.
