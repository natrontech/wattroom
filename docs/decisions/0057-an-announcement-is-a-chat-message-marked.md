# ADR-0057: An announcement is a chat message marked

- Status: accepted, amended 2026-09-22 by [ADR-0058](0058-the-room-dissolves-into-the-crew.md) (#2425): one per text channel, marked by the crew's admins
- Date: 2026-09-20
- Extends: [ADR-0010](0010-room-first-positioning.md) — the 500-message bound this makes one exception to
- Beside: [ADR-0056](0056-a-crew-pins-what-it-keeps-needing.md) — pins, decided in the same conversation and deliberately not this

## Context

A coach needs to tell the room something that outlasts the moment: no session
Thursday, the route changed, bring a spare tube. Chat scrolls, and `PruneChat`
caps a room at 500 lines, so the sentence has a shelf life measured in busy
evenings.

Pins (ADR-0056) landed first and the obvious move was to make this a second
kind of pin — one page, two sections. That is wrong, and the reason is the
whole of this decision.

## Decision

**A page is pull; an announcement is push.** A pin is looked up on purpose —
"what was the server address again" — and the rider goes to the board to get
it. An announcement is the opposite errand: it has to reach people who were
not looking for it. Put it on a page and the riders who needed it are exactly
the ones who did not open that page.

So an announcement gets **no page and no place**. It is a strip at the top of
the Lounge and of Chat, and it is there when the rider arrives.

### It is a chat message a coach marked

Not a second content system. The room already has the log, the composer,
`room_reads` and the unread counts, and an announcement wants all four and none
of them differently. A separate composer would duplicate the log, the read
tracking and the retention, and leave a coach choosing which of two boxes to
type a sentence into.

So the whole of it is: `rooms.announcement_id`, a nullable pointer at a line
already in the log, and `Announce this` on that line's own context menu. The
notice keeps the **message's** author and timestamp, because a coach putting
somebody else's sentence up is quoting them, and the strip says so.

**One at a time, structurally.** The column is on the room, so marking a new
one replaces the old — a room cannot accumulate notices nobody remembers
posting, and it is also how a coach retracts a wrong one without a second
control.

### The prune makes an exception

`PruneChat` keeps the marked line whatever its age. The cap is the reason a
coach marks one at all, and without the clause a busy week would silently take
the notice down — the one thing the mark promises will not happen, reported by
nothing. It is at most one row per room.

### Coaches only

> **Diverged 2026-09-22 (#2425, ADR-0058)** — a coach is no longer a standing role but whoever runs tonight's session, and an announcement speaks for the crew: marking and clearing are the crew's owner's and admins'. The amendment at the end has the rest.

Marking and clearing are the coach's and the owner's, per docs/SPEC.md's roles
matrix — unlike pins, which anyone in the crew writes. A pin is a shared fact;
an announcement speaks for the room.

### Idle-only on the Lounge

The strip draws on the Lounge only while the room is idle. Mid-session that
column is the tiles, the sprint and the stage, and next Thursday pushing them
down is the opposite of what a rider on a bike needs. It is waiting when the
session ends. In Chat it is always above the log.

## Amended 2026-09-20 (#2413): it draws on the Board too, which is first

This ADR said an announcement "gets no page and no place", and the reasoning
was that a page is pull. That reasoning assumed a place somewhere down the
room's list, where a notice is filed rather than announced.

The Board is the **first** row of the room, above the Lounge. A rider entering
the room passes it, which is the property the strip was protecting. So the
notice draws there as the board's first item, and **the Lounge keeps its strip
as well** — the board is where the notice lives and is taken down, the strip is
the same notice appearing where a rider already is when a coach puts one up
mid-session.

What has not changed is the part worth keeping: there is still no announcement
composer, it is still a marked chat message, and it still arrives rather than
waiting to be fetched. "No page" was the wrong way to say that. The right way
is that **an announcement must not depend on a rider choosing to go and look**,
and a first row plus a strip on the room's own front page both satisfy it.

## Consequences

- One nullable column and one clause in `PruneChat`. No new table, no new
  socket command: marking pings the lobby and the notice arrives on the room
  read, the path a planned session already takes.
- `ThreadSource.announce` joins `ban` and `react` as a capability, so a DM and
  every non-coach get no such menu item rather than one that is refused.
- Taking it down is an **undo toast, not a confirm**: the message is still in
  chat and can be marked again, and [errors.md](../../.claude/rules/errors.md)'s
  ask is for what cannot be undone.
- **It does not reach anyone outside the room.** A rider who never opens the
  room never sees it. Whether a notice should follow them to the sidebar or a
  notification is a real question and a separate one — pushing further is a
  decision about interruption, and it is not made here.
- Nothing expires on its own. "Until a coach replaces or clears it" is zero
  fields; a date a coach sets is a third, and no one has asked for it.

## Amended 2026-09-22 (#2425, [ADR-0058](0058-the-room-dissolves-into-the-crew.md)): one per text channel, marked by the crew's admins

The room dissolves into the crew: its chat becomes a text channel and its
Lounge a voice channel. The announcement stays exactly what this ADR made it —
a chat message marked, no composer, kept through the prune — and re-keys:

- **The pointer is on the text channel**, so there is one announcement per
  text channel and marking a new one there replaces the old. The prune
  exception holds per channel.
- **The crew's Board leads with the newest** across its text channels; a text
  channel shows its own above its log.
- **The Lounge's idle-only strip moves with the Lounge** to the voice channel
  page, idle-only as before, and carries the crew's newest — the surface the
  2026-09-20 amendment kept for _the same notice appearing where a rider
  already is_.
- **Marking and clearing are the crew's owner's and admins'** (marked at
  "Coaches only" above). Pins stay everyone's; the line between a shared fact
  and a voice for the crew is where it was.

The test the 2026-09-20 amendment wrote is unchanged and is what the surfaces
above answer to: **an announcement must not depend on a rider choosing to go
and look.**
