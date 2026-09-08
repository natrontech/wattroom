# 0039 — The public room directory shows a door, not a window

- Status: accepted
- Date: 2026-09-08
- Answers: [#1118](https://github.com/natrontech/wattroom/issues/1118), split
  out of [#1099](https://github.com/natrontech/wattroom/issues/1099)
- Sits beside: [0038](0038-the-crew-is-the-layer-above-rooms.md), whose
  crew-visibility is a **different axis** and stays one
- Constrained by: WATTROOM.md's locked privacy rules — metrics room-scoped,
  rides private by default, no public leaderboards

## Context

`rooms.listed` has existed since `00001_init.sql`, default `false`, with a
comment insisting the default belongs in the schema rather than in whoever
writes the INSERT. Nothing ever read it. [#698](https://github.com/natrontech/wattroom/issues/698)
closed by removing the only toggle and keeping the column, because a switch
with nothing behind it is worse than no switch: a rider who wanted their room
discoverable would have believed it was.

WATTROOM.md names the directory a fast-follow and already describes its shape:
*"Rooms are private/unlisted by default; a directory listing is a per-room
owner choice, and metrics stay visible only to people who actually join."*

This is the first surface in WattRoom that says anything about a room to
somebody who has never been in it. That is why it gets an ADR rather than a
handler.

## Decision

**A directory entry is a name, an icon and a link. Nothing else.**

No member count, no activity, no owner, no last-ridden, no "busy now". Each of
those is a separate disclosure to a stranger, and
[#1025](https://github.com/natrontech/wattroom/issues/1025) is currently open
and `needs-human-input` on whether a room-**mate** may see the counts behind a
social badge. A question undecided for somebody inside the room is not
answerable for somebody outside it.

The asymmetry is what makes this the right default: **adding a column later
widens what strangers see and is a decision anyone can take deliberately.
Removing one narrows it and breaks a promise already made.** The narrow
version is the one that can still move.

**Listing widens discovery, never access.** A listed room's non-members get
exactly what they got before — no chat, no roster, no metrics, no sound pack,
no join code. The directory tells you a door exists and where it is. It is not
a window, and `TestListingARoomOpensNoDoor` is the assertion, not this
paragraph.

**"Public" means every signed-in rider, not the web.** ADR-0009 gates the whole
app behind a login and this changes nothing about that: the route refuses a
signed-out caller. An instance's directory is its own riders' directory.

**Unlisted stays the default, in the schema.** #698's sentence survives intact.
Nothing about shipping the directory changes any existing room.

**A list, ordered by name.** Not a search: there is nothing to search yet, and
`ux.md`'s 95% rule applies to a search box as much as to a setting. Not ordered
by size or activity, because those are precisely the disclosures above. Paged
at 50, so the route cannot enumerate an instance in one request.

**The toggle is worded as the choice it is** — *Unlisted / Listed*, each saying
what actually happens, including the half riders assume and should not: being
findable is not being readable.

**It is not a place in the nav.** `nav/pages.ts` retires anything that is "the
second half" of another page, and finding a room to join is the second half of
joining one. It hangs off the join card at `/home#rooms`.

## Consequences

- Easier: WATTROOM.md's fast-follow exists; `rooms.listed` stops being a knob
  with nothing behind it, which was #698's actual complaint rather than the
  column's existence.
- Harder: the first surface with a "what may a stranger see" question means
  every future addition to a directory entry is a privacy decision, and should
  amend this ADR rather than adding a column.
- Accepted: a directory that shows only names is less useful than one showing
  activity. That is the trade — and it is reversible in the direction that is
  safe to reverse.
- **Crew visibility (ADR-0038) is untouched and stays a separate axis.** No
  room becomes listed by gaining members or a crew, and listing a room says
  nothing about any crew. Asserted in `TestListedIsNotCrewVisibility`.

## Alternatives considered

**Showing a member count.** The most-requested-looking column, and the one
#1025 is open about for people who are already in the room. Rejected on the
asymmetry above: it can be added the day somebody decides it, and cannot be
taken back.

**Leaving `listed` unread and deleting the column.** Rejected by #698, which
kept it precisely because the directory was still intended. Doing it now would
have been the third change to the same boolean.

**A search box.** Rejected as premature by `ux.md`'s own rule. Additive the day
the list is too long to read.

**Making the directory public to the web.** Rejected: ADR-0009 gates the app,
WATTROOM.md's copyright and privacy posture assumes a logged-in instance, and
"opt-in public" was never written to mean "opt-in to search engines".
