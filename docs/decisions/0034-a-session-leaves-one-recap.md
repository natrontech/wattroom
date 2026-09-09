# 0034 — A session leaves one recap: who was here, and for how long

- Status: accepted
- Date: 2026-09-07
- Amends: [0022](0022-room-events-are-ephemeral.md) — the revisit it asked for,
  on the terms it set. Room events stay ephemeral; one artifact per session
  does not
- Constrained by: WATTROOM.md's locked privacy rules, which this does not
  touch — live metrics stay inside the room, rides stay private by default
- Answers: [#985](https://github.com/natrontech/wattroom/issues/985)

## Context

Riders finish a session and want to look back at who was there. Today nothing
survives it. Room events ride the tick and are drained each second
([0022](0022-room-events-are-ephemeral.md)); the roster is live state in
memory; the only durable trace of a group ride is each rider's own private
`rides` row, which says nothing about anybody else.

[0022](0022-room-events-are-ephemeral.md) closes with the condition for
reopening it:

> Revisit if riders start asking for a set list after the ride — that is a ride
> artifact belonging to the ride record, not a chat backlog.

That sentence already contains the answer's shape. The thing to build is a
**ride artifact**, not a persisted event stream — and the distinction is the
whole decision.

## Decision

**One row per session, written once when the session ends.** A new
`session_recaps` table holds the shared timeline's name, its start and end, and
one interval per rider who was present: when they arrived, when they left,
and whether they rode. The chat pane renders it as a card, collapsed, merged
into the timeline by timestamp the way ephemeral events already are.

Four things this settles, so they are not reopened per surface:

1. **A card, not an activity tab and not persisted events.** The card is the
   artifact; the event stream stays ephemeral.
2. **Presence and time only.** No watts, no kJ, no execution, no heart rate, no
   per-rider workout — in the table, in the API response, or on the card.
3. **90 days**, then pruned.
4. **Members only.** Leaving the room ends access.

### Why this is not what 0022 refused

0022's argument is about **noise**, not durability as such. Its case is that "a
month of now-playing in the backlog is noise around the conversation people
actually want to scroll back to", and that the lines are worthless the next
day. Both are true of a firehose of individual events and neither is true of
one collapsed card per session: it is one entry, it summarises rather than
repeats, and it is the thing riders are asking to scroll back to rather than
the thing in the way.

The half of 0022 that must survive untouched is its first consequence, and it
does: **chat history stays what riders said.** The `chat` table gets no `kind`
column, no filter on read and no migration. The recap is its own table, joined
into the timeline at render time — exactly as ephemeral events already are,
which is why the client needs one new entry variant and no new pane.

### Why presence may become durable when metrics may not

Everyone in the room watched the roster the entire time. The card writes down
what all of them already saw, about a room they were all standing in. It tells
no rider anything they did not have.

Numbers are a different question, and WATTROOM.md locks it: _live metrics
visible only inside the room, only while riding_, and _rides private by
default, shared per-ride opt-in_. A watts column in a durable artifact would be
one rider's ride handed to everyone else, permanently, with no per-ride opt-in
anywhere near it. That is the rule this decision is careful not to touch — so
"never stored" is a list rather than a sentence: watts, kJ, execution, heart
rate, per-rider workout. Heart rate is named separately because
[0008](0008-heart-rate-retention.md) already keeps it out of anything
scoreable, and a shareable artifact is the case that rule exists for.

"Which training" is answered once, in the header, because everyone rode the
same shared timeline. That is what a session is.

### What 90 days buys

Ninety days answers "who rode with us last month" and stops answering "where
was this person in March". A room is a crew, not an attendance register, and
a record that never expires slowly becomes one. The number lives in
docs/SPEC.md with the rest of the product's numbers, not in this ADR, so it can
be tuned without amending a decision.

### What a restart costs

The intervals come from presence the hub accumulates in memory across the
session. A server restart mid-session loses what it had, and the recap then
honestly covers from the restart. The alternative — writing every join and
leave to disk so a rare event is survivable — is precisely the firehose
0022 exists to avoid, and it would cost every session to insure a few.

## Consequences

- The recap is the first thing in this app that survives a reload of the
  timeline. `TimelineEntry` grows a third variant; `chat` is untouched.
- Presence intervals are per rider, so **a rider deleting their account has to
  be removed from every recap row that names them**, not cascaded away by a
  foreign key — `riders` is a jsonb array. A ghost interval saying "someone
  left at 19:40" is still a record of a person. Export-all includes a rider's
  own intervals ([0009](0009-login-gated-app.md)'s account, GDPR Art. 15 /
  revFADP Art. 25).
- Room deletion cascades; the recaps go with the room.
- A session that never started writes no row. Sitting in a room for an hour
  with no session leaves no artifact at all — recording idle presence is a
  much larger promise about a room watching people, and it is deliberately not
  made here.
- The next durable artifact anyone wants (a set list, a game's results) has a
  precedent to argue against rather than an open field: one row per session,
  written at the same seam, carrying what the room already saw.
- If metrics in the card are ever wanted, this ADR is not the argument for
  them. It is the argument for why they need their own.

## Amendment — the Sessions place lists the past (2026-09-09, #1335)

The card in the chat stays what it is. The same row also feeds a **past**
section on the room's Sessions place, so "who rode with us last month" is
answered where sessions are planned rather than by scrolling the
conversation. Same row, same ninety days, same members-only rule: nothing new
is stored and nothing in the four settled points above moves. The Sessions
place is the room's calendar in both directions, which is what a calendar is.
Recorded with the navigation map in
[0020](0020-the-app-takes-discords-shape.md)'s 2026-09-09 amendment; built in
[#1331](https://github.com/natrontech/wattroom/issues/1331).
