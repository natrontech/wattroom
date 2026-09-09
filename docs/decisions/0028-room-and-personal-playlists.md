# 0028 — Save playlists for rooms and riders; autoplay only an idle deck

- Status: accepted
- Date: 2026-09-05
- Extends: [ADR-0026](0026-a-playlist-is-one-queue-entry.md), which decides a
  pasted YouTube playlist is one transient queue entry
- Supersedes: [ADR-0015](0015-self-hosted-music-pool.md)'s "playlists are
  user-owned, visible to all logged-in users" sentence. Room-owned or
  rider-owned is the rule; 0015 said otherwise for a month and misled a
  reader into nearly filing a scope bug against working code (#1097)

> **Amended 2026-09-09 (#1422):** the optional _fixed start_ is dropped
> (the 95 % rule — the active playlist's first entry is the start), and
> autoplay is set on the room's Settings page rather than in the jukebox
> panel. `rooms.autoplay_fixed_video_id/_title` stay one release for the
> rollback path (ADR-0019); #1430 drops them.
>
> **Superseded in part by [ADR-0045](0045-a-saved-playlist-is-a-saved-queue.md)
> (2026-09-09, #1426):** a saved entry is a video, a pasted playlist, _or a
> library track_ — one object, no third kind. The scope rule the note below
> asked for is written there.
>
> **Note (2026-09-08):** a saved entry is a `video_id` — YouTube only — so no
> playlist can hold a self-hosted pool track today. When
> [#655](https://github.com/natrontech/wattroom/issues/655) makes saved
> playlists multi-source, an entry pointing at a pool track inherits that
> pool's scope (per uploader since
> [#1095](https://github.com/natrontech/wattroom/issues/1095)), and #655's
> ADR is where that has to be said. A playlist must not become a way around
> who may hear a shelf.

## Context

#627 added durable room playlists, personal playlists, and room autoplay.
They make the jukebox feel like part of a persistent room rather than a queue
that disappears after each ride. The change introduced a second saved meaning
of "playlist" beside ADR-0026's pasted YouTube playlist, without recording
why the objects have different owners or how autoplay behaves. ADR-0015 also
uses the word for its still-unbuilt self-hosted music-pool library.

## Decision

**Room playlists are durable, room-owned lists.** Any room member can create,
rename, delete, and edit them. A room may have several, but exactly one is
active. The active room playlist is the source that autoplay and the panel's
default queue action use.

**Personal playlists are durable, rider-owned lists.** Their rider manages
them and may queue one into a room they are in. They do not become room state
or take part in selecting that room's autoplay source.

**Autoplay fills silence; it never interrupts.** When a rider joins and the
deck has neither a current entry nor a queue, the active room playlist starts.
It may use its configured ordered or shuffled order, with an optional fixed
start before the playlist. A playing deck is left alone.

The three meanings stay distinct:

- a pasted YouTube playlist is one transient queue entry that walks its tracks
  ([ADR-0026](0026-a-playlist-is-one-queue-entry.md));
- a room or personal playlist is a saved list of jukebox entries; and
- ADR-0015's unbuilt music-pool library playlist remains its own object and
  does not inherit room ownership or autoplay semantics from this decision.

## Consequences

- The room gets a durable default without a rider's personal collection
  silently becoming shared state.
- The deck remains a social surface: joining a room never replaces something
  the room is already hearing.
- UI and API names must say whether they address a pasted, room, personal, or
  future library playlist; one generic type would erase behaviour that matters.
- Implementing ADR-0015's library playlists needs an explicit boundary with
  these saved lists rather than reusing their ownership or autoplay rules.
