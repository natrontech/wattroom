# ADR-0021: The calendar feed is addressed to the rider, not the room

- Status: accepted, amended twice on 2026-09-17 (#1693, #1767); amended 2026-09-22 by [ADR-0058](0058-the-room-dissolves-into-the-crew.md) (#2425): the crew feed replaces the room feed
- Date: 2026-08-31

## Context

The iCal feed (#245, shipped in #249) gives every room a secret token and a URL: `/api/rooms/{slug}/calendar/{token}.ics`. Calendar apps cannot sign in, so the URL carries the secret — the private-address pattern Google Calendar uses.

Addressing a *room* was the obvious first move and the wrong unit. A rider in four rooms subscribes four times, re-subscribes when they join a fifth, and gets a stale entry in their calendar list when they leave one. Worse, the affordance was rendered inside the lounge's planned-session card, which only exists when a session is already planned — so the answer to "where do I subscribe" was "plan something first". Riders reported not being able to find calendar URLs at all.

The unit riders actually think in is "my sessions". That crosses rooms, which is new: no other WattRoom surface aggregates across rooms behind a single unauthenticated URL. Metrics are room-scoped by architecture and stay that way.

## Decision

Riders get their own feed token (`users.ics_token`) and their own URL, `/api/calendar/{token}.ics`, listing planned sessions in every room they are a member of. Membership is resolved **on read**, so joining or leaving a room changes the feed without re-subscribing. This is the feed the UI offers first.

Room feeds stay exactly as they are. They address a different subject — a club's schedule, shareable with people who are not members — and existing subscriptions must not break.

> **Diverged 2026-09-22 (#2425, #2441, ADR-0058)** — rooms are gone, so the room feed goes with them and its URL answers 404; a subscribed calendar goes quiet and has to subscribe again, to the crew's feed. The amendment at the end says why the room's address is not pointed at the crew's schedule instead.

Planned sessions are the only thing either feed carries. Metrics, ride history, and room membership lists are not calendar data and never enter a feed.

## Consequences

- One subscription per rider, for good. The `/sessions` page is where the URL lives, alongside the planning it mirrors.
- A leaked rider URL reveals more than a leaked room URL did: what you plan to ride, when, and which rooms you are in — a membership list by implication. Accepted, with the same escape hatch (`POST /api/calendar/rotate`, owner-equivalent, instant) and the warning stated on the page rather than buried.
- Two feeds mean two handlers over one `icsEvent` builder. The cross-room query is also what `/api/schedule` serves, differing only in horizon — the feed keeps a month of history, the page starts at the 30-minute grace.
- The tokens are separate on purpose: rotating your own feed must not break a room's, and a room owner rotating theirs must not break every member's.
- Revisit if feeds ever need to carry something a member can see but a link-holder should not — that is the point where the bearer URL stops being sufficient and the feed needs per-subscriber scoping.

## Amendment, 2026-09-17 (#1693): the list is on Home, the link is in Settings

"The `/sessions` page is where the URL lives, alongside the planning it
mirrors" went stale twice over, in opposite directions, and the consequence
above is the last place that still said it.

[ADR-0020](0020-the-app-takes-discords-shape.md) retired `/sessions` into
Home — `/sessions` is a redirect stub to `/home#sessions` — so the page named
here no longer exists. And #1860 moved the URL itself off Home to **Settings ›
Data**, with the account's other bearer secrets: a link that says what you plan
to ride and which rooms you are in belongs with the export and the API tokens,
not on the between-rides screen.

So the two halves are in two places on purpose, and each points at the other:

- **The list is Home's "What's next"** — every planned session in every room
  you are in, one row per session. It is the same `ListUserCalendar` query the
  feed reads, differing only in horizon, which is what makes "the page and the
  calendar say the same thing" a property rather than a hope. It had not been:
  Home rendered the rail feed's per-room `next`, so a room with three plans this
  week showed one of them while the feed listed all three (#1693).
- **The link is Settings › Data**, and Home carries a pointer to it under the
  list it subscribes to — which is the affordance this ADR was written to fix.
  The warning stays stated where the link is, not buried.

RSVP does not follow the list out of the room. Home lists what is coming;
saying you are in is per-room planning, which ADR-0020 left in the room's own
Sessions place, so `/api/schedule`'s row carries no `going` — it declared the
field and never filled it, which is what surfaced all of this. Revisit if
riders start asking to answer from Home; nothing here forecloses it.

## Amendment, 2026-09-17 (#1767): the room's feed stops naming planners

The last consequence above set a trigger: "Revisit if feeds ever need to carry
something a member can see but a link-holder should not." A planner's name is
that thing, and this is the revisit.

**What shipped and what changes.** Every event in both feeds carried
`Planned by <name> in <room>.` as its DESCRIPTION. In the *room* feed that is
a display name handed to whoever holds the link — and the link is held by a
crowd: `rooms.ics_token` is given to every non-banned member, rotation is
owner-only, and the Decision above says in as many words that the room feed is
"shareable with people who are not members". One member forwarding it is the
feed working as designed, and it took every planner's name along. The room
feed's DESCRIPTION is now `In <room>.` Nothing else moves: summary, start,
end, LOCATION and the room URL are what a club schedule is for, and none of
them says who anybody is. The name is not merely dropped in Go — the room
feed's query stopped selecting it, so what the feed must not say, it does not
read.

**The rider's feed keeps the planner, and the asymmetry is the decision.**
Two feeds, two subjects, two holders. A rider's token is their own, they
rotate it themselves, and their feed lists only rooms they are a member of —
so it tells them nothing they cannot already read in the room, where
[ADR-0036](0036-what-a-room-shows-about-its-members.md) gives members each
other's names. The room's token is one secret shared by everyone in the room
and meant to travel further. Same builder, one branch, and the feed that
leaks by design is the one that says less.

**Not per-subscriber scoping.** The trigger asked whether the bearer URL had
stopped being sufficient. It has not. Dropping the single member-only field
the room feed carried leaves it a public-by-token document, which is a thing a
calendar URL can safely be; per-subscriber scoping is what the next such field
would cost, and there is no next field today. A room feed is still worth
rotating if it leaks — it says when this room rides, which is not nothing —
and the Advanced expander on the room's own Sessions place is still where
that happens.

## Amendment, 2026-09-22 (#2425, [ADR-0058](0058-the-room-dissolves-into-the-crew.md)): the crew feed replaces the room feed

The room dissolves into the crew, and its schedule with it: a plan is the
crew's and names the voice channel it will run in. So the second feed this ADR
kept — _a club's schedule, shareable with people who are not members_ — is the
**crew's**, on `crews.ics_token` (#2441), with the rotate, the confirm and the
bounds the room feed had. The rider feed is unchanged in shape and unions the
crews the rider is in, resolved on read as before.

**Existing room subscriptions break, and that is the decision rather than an
oversight.** Keeping them alive would mean answering a room's address with its
crew's schedule, and that widens what a link already sitting in somebody's
calendar discloses: plans in every channel of the crew, handed to a holder who
was given one room's. A feed that goes quiet is recoverable by subscribing
once more; a feed that quietly says more is not recoverable at all. The crew's
settings page says so once, and the release notes say so before anybody
upgrades.
