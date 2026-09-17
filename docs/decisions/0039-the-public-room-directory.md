# 0039 — The public room directory shows a door, not a window

- Status: accepted
- Date: 2026-09-08
- Answers: [#1118](https://github.com/natrontech/wattroom/issues/1118), split
  out of [#1099](https://github.com/natrontech/wattroom/issues/1099)
- Sits beside: [0038](0038-the-crew-is-the-layer-above-rooms.md), whose
  crew-visibility is a **different axis** and stays one.
  **Diverged 2026-09-17 (#2245, ADR-0038)**: the axes are coupled,
  `listed ⇒ crew_visible`, and a listed room is a public door into its crew
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

> **Diverged 2026-09-17 (#2245, ADR-0038)** — listing widens **access** as
> well, and it widens it to the crew: joining a listed room from the directory
> joins its crew first and the room second. The enumeration in this paragraph
> stands word for word — a non-member still sees no chat, no roster, no
> metrics, no sound pack and no join code, and the entry is still a name, an
> icon and a link. What has changed is only that the door opens, and what it
> opens onto. See the amendment below.

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
  **Diverged 2026-09-17 (#2245, ADR-0038)**: only the first half survives. A
  room still never becomes listed by gaining members or a crew — that is the
  direction `TestListedIsNotCrewVisibility` asserts, and it is unchanged — but
  listing a room now says a great deal about its crew, and the axes are coupled
  in SQL by `listed ⇒ crew_visible`. See the amendment below.

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

## Amendment, 2026-09-17 (#2245): listing widens access too, and the access it widens is the crew's

This ADR's title is still right — the directory shows a door, not a window —
but "Listing widens discovery, never access" was written before
[ADR-0038](0038-the-crew-is-the-layer-above-rooms.md)'s 2026-09-08 invite
amendment moved the door from the room to the crew, and it has been false since
[#1671](https://github.com/natrontech/wattroom/issues/1671) shipped. The
2026-09-17 rooms-and-crews audit found the two ADRs contradicting each other
with the code implementing one of them; **decided in session, 2026-09-17: the
behaviour stays and this ADR's sentence goes.**

**Listing widens discovery *and* access, and the access it widens is the whole
crew's.** A signed-in rider who joins a listed room from the directory is put in
its crew and then in the room, which also opens the crew's other crew-visible
rooms to them and hands them the crew's invite code. ADR-0038's 2026-09-17
amendment is where that is reasoned out, what it costs, and what a room owner is
agreeing to when they tick "Listed"; it is not restated here.

**What this ADR decided still stands in full**, and the distinction is worth
keeping sharp, because it is the half that makes the directory safe:

- **A directory entry is a name, an icon and a link. Nothing else.** No member
  count, no activity, no owner, no last-ridden, no "busy now". The asymmetry
  argument is untouched — a column added later is a decision anyone may take,
  a column removed is a promise broken.
- **A non-member reads nothing.** No chat, no roster, no metrics, no sound
  pack, no join code. The room's own read refuses them exactly as it did before
  the room was listed, and `TestListingARoomOpensNoDoor` asserts that read.
- **"Public" is every signed-in rider, not the web**; unlisted is still the
  default and still lives in the schema; the list is still ordered by name and
  paged at 50; the toggle still says what it does.

So the correction is narrow and worth stating narrowly: **the directory is
still not a window. It is a door that opens further than this ADR said it
did.** Discovery and reading are unchanged; only entry is wider, and it is
wider by exactly one crew.

**`listed` and `crew_visible` are no longer independent axes.** Both are
enforced coupled in SQL (`UpdateRoom`, `SetRoomCrewVisible`,
`SetRoomCrewVisibleAndListed` in `server/internal/store/queries/`): a room
listed publicly is always open to its crew, and shutting it to the crew drops
the listing in the same statement. The half of the old bullet that still holds
is the other direction — a room never becomes listed by gaining members or a
crew — and that is what `TestListedIsNotCrewVisibility` asserts, unchanged.
