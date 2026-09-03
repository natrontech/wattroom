# ADR-0026: A YouTube playlist is one queue entry, resolved by the client

- Status: accepted
- Date: 2026-09-03
- Extends: [ADR-0018](0018-one-music-surface-drop-the-jam-card.md) — the jukebox is the room's one music surface; this decides what a *playlist* is on it

## Context

Riders paste playlist links, and the jukebox had no answer for them (#615). `watch?v=X&list=…` silently dropped the list and queued the single video; a bare `youtube.com/playlist?list=…` was rejected as "not a YouTube link", which is a lie about a perfectly good link.

Two questions had to be settled together, because the answer to each constrains the other: what a playlist *is* in the queue, and who works out which videos are in it.

The obvious implementation — flatten the playlist into N queue entries on add — fails on the queue's own terms. `maxQueue = 50` exists because "nobody queues fifty songs in good faith", and one paste would consume all fifty. Worse, the vote/float mechanic that makes the queue a fair party queue stops describing the room and starts describing one rider's taste. And "skip this playlist" degrades from an action into a cleanup: removing thirty-nine rows.

Resolution has its own trap. WATTROOM.md §3 sanctions the YouTube Data API for resolving entries, and `playlistItems.list` costs one quota unit per fifty items — cheap, exact, and it puts YouTube knowledge in the server, which docs/ARCHITECTURE.md's seam deliberately keeps out ("the server holds an anchor, not a timeline… it knows nothing about YouTube itself"). It also needs an API key, which every self-hoster would then need too.

## Decision

**A playlist is one queue entry whose `VideoID` changes over its life.**

`JukeboxEntry` gains `PlaylistID`, `PlaylistTitle`, `Tracks` and `Index`. `VideoID`/`Title` keep meaning *what is on the deck right now* — for a playlist, `Tracks[Index]`. An entry is a playlist exactly when it carries tracks; there is no second flag to drift out of sync with the list it describes.

The consequence that made this the design rather than merely a design: **no client playback path needed a playlist branch.** The loader, the tiered drift chase, the `(videoId, anchorMs)` ended-dedup, the non-embeddable auto-skip and the timeline lines all read those same two fields. Only `advance()` learned anything new — step inside the entry if it has a track left, otherwise leave for the next queue entry.

**Advance only ever moves forward.** A playlist runs once, start to end, and never restarts itself or wraps. Running off the end advances the *queue*.

**`back` is the music-player idiom, not the inverse of skip**: more than three seconds into a track it starts that track over, otherwise it steps back one track. Walking a playlist backwards by hand is fine — the no-repeat rule is about auto-advance. At track 0 it stops: stepping across queue entries would mean re-inserting from history at the head, which is undo-the-queue and a different feature.

**`skipPlaylist` drops the rest of a set**, and every member may use it — the same level as every other jukebox control in docs/SPEC.md's matrix. This is what makes a long playlist safe to queue at all: the fairness answer to "one rider parked two hours on the deck" is that anyone can end it.

**Resolution is client-side and keyless.** A hidden player *cues* the playlist — never loads it, so nothing ever plays — and `getPlaylist()` yields the ids; keyless oEmbed fills in the titles, in parallel. The resolved list rides the `add` command, so the server still knows nothing about YouTube: it holds a list somebody handed it, the way it holds a title.

Caps: fifty tracks per playlist (the queue's own number), and a new two-hundred-track ceiling across the queue, because an entry cap bounds nothing once one entry can hold fifty videos.

Vocabulary stays **playlist**. docs/SPEC.md's glossary was loosely calling the whole jukebox "a shared YouTube playlist"; that line is fixed rather than a synonym being coined, because riders paste a thing YouTube calls a playlist and ux.md forbids inventing per-screen names.

## Consequences

- One paste takes one slot. The fifty-entry cap, the vote order and the reorder handles all keep meaning what they meant.
- History records **tracks, never playlists** — "just played" exists so somebody can put a song on again, and a playlist's name was never a song.
- Every track of a playlist played through earns its own DJ credit (#467); the owner leaves with the entry, not with its first track.
- A track cannot be pulled out of a queued playlist, voted individually, or reordered within it. Accepted: the set is the thing that was queued, and a per-track verb would be a button that fails.
- Resolution is subject to whatever the IFrame player will load — believed to be around two hundred videos, capped to fifty here regardless. A playlist longer than that queues its first fifty and says so.
- The cue-only resolver never plays media, so YouTube's RMF rules — the ≥200×200 visible tile, nothing overlaid, no background playback — are not engaged by it. They continue to govern the dock, which is the only player that plays.
- `playlistItems.list` remains the documented upgrade if client-side resolution proves flaky: it would change where `Tracks` is filled in and nothing else, since the wire shape is the same either way.
- Revisit when the self-hosted pool ([ADR-0015](0015-self-hosted-music-pool.md), #264/#268) brings library playlists. Those are a stored, editable object; this is a snapshot of somebody's link. They share a word and should not share a type.
