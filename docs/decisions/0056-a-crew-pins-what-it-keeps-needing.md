# ADR-0056: A crew pins what it keeps needing

- Status: accepted
- Date: 2026-09-20
- Extends: [ADR-0038](0038-the-crew-is-the-layer-above-rooms.md) — the crew is what owns things several rooms share
- Extends: [ADR-0020](0020-the-app-takes-discords-shape.md) — what earns a place inside a room

## Context

A crew keeps a handful of facts that nothing in the app holds. The one that
prompted this: the address and password of the game server the crew plays on
between rides. Others look the same — the Discord link, the door code of the
gym, which of two rooms Tuesday happens in.

Chat cannot hold them. `PruneChat` caps a room at 500 lines (ADR-0010 amended),
so anything posted there has a shelf life measured in busy evenings, and
finding it again means scrolling. The room's settings are about the room. A
rider who wants the server address has nowhere to look, so the answer is asked
for in voice, every time, by whoever joined last.

## Decision

**A pin is a title and a block of lines, owned by the crew.**

### Not a key and a value

The first shape drawn was `label → value` with a copy button, and it was wrong
in a way only a real example showed: a server is its address AND its password
AND who to ask about the whitelist, and three cards lose which server they
belong to. So a pin has one title and one body.

The body is **plain text with one rule**: a line written `Label: value` draws
as a row with its own copy button, and everything else stays prose. The editor
is a single textarea — no field repeater, no add-a-row button, no schema.
Nobody adds a row, names it and fills it; they type what they would have typed
into chat, and the lines that happen to be facts become tappable.

The space after the colon is what makes that rule safe. `Start: 20:00` is a
field whose value is a time; `We start at 20:00` is prose. Without the space
the second becomes a field labelled "We start at 20". It also excludes a bare
URL for free, since `https://` has no space after its colon, so a link on its
own line is recognised as a link rather than shredded into a field called
"https". `web/src/lib/pins/pins.test.ts` holds those cases.

### The crew owns it; the room is where it is read

The board hangs off `crews`, not `rooms`: a fact about the server the crew
plays on is not true in one room and false in the next, and a crew with four
rooms should not keep four copies of its door code.

It is **read and written in a room** all the same — `/r/[slug]/pins`, a place
between Sessions and Members. A page is pull, and this one is the pull case: a
rider looks a pin up on purpose. They are standing in a room when they do it,
so sending them to the crew's page to read the address, or to change it, is a
detour with nothing at the end of it. Every room of the crew shows the same
board and the place says so.

**The row is always there.** It was built the other way first — hidden until
the crew had pinned something, on the argument that a sidebar listing
everything lists nothing — and that made the feature unreachable: pinning
happens on the page the row is the only way to, so a crew with an empty board
could never make its first pin. It survived a mock, where the board was seeded,
and failed the first time a real empty crew opened it.

`ux.md`'s capability gating is for an **absent precondition** — no trainer
paired, LiveKit down, not embeddable — and an empty board is not one: every
crew can pin. It is an empty state, and the rule for those is that they teach
and carry the CTA that makes the first one. So the row is always offered, and
the place's empty state is the onboarding.

### Everyone in the crew writes

Not admins. A crew is a group of friends who ride together; the person who
knows the new server password is whoever set the server up, and making them ask
an admin to type it in is friction with no failure behind it. Nothing records
or checks **who** wrote a pin either: the board is shared, every write is
undoable, and per-pin authorship is machinery for a problem a crew of friends
does not have.

This is the decision most likely to read as an oversight in review, so the
server's tests assert it: a plain member edits and unpins another member's pin,
and adding a permission check fails there.

### Bounded, so it stays a board

Twenty pins per crew, a 40-character title, a 1000-character body — declared in
`protocol` and generated into the client (#2122), enforced in one statement so
two members pinning at once cannot both pass a count check. Twenty is a board;
two hundred is a wiki. A crew that needs more than this needs a document, and
this feature is deliberately not one: no rich text, no attachments, no
comments, no threads, no history.

## Consequences

- One new table, `crew_pins`, cascading from its crew and `SET NULL` on its
  author — a member deleting their account must not take the door code with
  them.
- Four endpoints under `/api/crews/{id}/pins`. Membership is the whole
  permission; a non-member gets 404 rather than 403, because saying "you may
  not" about a crew they cannot see would confirm it exists.
- Every write pings the lobby, so a neighbour's pin reaches the board on the
  next ping. No new socket command.
- **A pin is not a secret.** Every member of the crew can read one, they are
  stored in the clear, and the editor says so in a line. Anything that would
  matter if a crew-mate read it does not belong on a pin — the feature makes no
  claim it cannot keep, which is why there is no mask and no reveal-on-click.
- An announcement is deliberately **not** this (#2408): a page is pull and an
  announcement is push, so it stays a marked chat message with a strip of its
  own rather than a second kind of pin.
