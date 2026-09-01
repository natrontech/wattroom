# ADR-0022: Room events ride the tick and are never persisted

- Status: accepted
- Date: 2026-08-31
- Amends: [ADR-0010](0010-room-first-positioning.md)'s chat rule as amended by #201 — chat lines persist, room events do not

## Context

The jukebox changes under everyone and says nothing (#321). A track is queued, another is skipped, a new one starts — and whoever is not looking at the dock at that second has no idea who did it. Thirty seconds later "who put this on?" is unanswerable.

Chat is already the room's timeline, and #201 made it durable: lines go to Postgres, a join seeds the backlog, reactions attach to persisted ids. Putting jukebox lines through that same path is the obvious move and the wrong one. A month of "now playing" in the backlog is noise around the conversation people actually want to scroll back to, and the lines are worthless the next day — nobody reads yesterday's playlist as history. Reactions on "kim skipped Sandstorm" are a feature nobody asked for.

The rendering surface and the storage are separable: the chat pane can interleave a second stream without the two sharing a table.

## Decision

Room events are a distinct wire type (`protocol.RoomEvent`), broadcast on the tick like cheers, drained each second, and **never written to the chat table**. The chat pane merges them into its timeline by timestamp; they render quieter than a message, with no avatar, no reactions and nothing to copy — Discord's join/leave shape. Nothing seeds them on join and a reload forgets them: whoever was in the room heard about it, and that is the whole audience.

The events are structured (`kind`, `verb`, `actor`, `track`, `count`), not sentences — the client owns the wording, so the dock and the timeline name a track with the same string, in docs/SPEC.md's vocabulary.

A rider's burst of adds coalesces into one growing line ("Kim queued 8 tracks") that re-broadcasts under its original id; the client replaces the line in place. Eight lines would push the actual conversation off the screen, which #291 already made awkward to scroll back through.

## Consequences

- Chat history stays what riders said. The `chat` table needs no `kind` column, no filter on read, and no migration.
- The lines cost one bounded slice per room and nothing on disk; a room nobody is in produces none that anyone misses.
- A rider who joins late, or reloads, sees an empty event history — accepted, and the same bargain cheers already make. Anything worth keeping is a chat message someone typed.
- Muting the lines per rider is a client-side filter on a separate stream, not a query change (not built yet).
- Vote outcomes (#269/#271) and any other "the room did something" line extend the same type; an unknown verb renders nothing, so an old tab degrades quietly rather than printing junk.
- Revisit if riders start asking for a set list after the ride — that is a ride artifact belonging to the ride record, not a chat backlog.
