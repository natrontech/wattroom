# ADR-0021: The calendar feed is addressed to the rider, not the room

- Status: accepted
- Date: 2026-08-31

## Context

The iCal feed (#245, shipped in #249) gives every room a secret token and a URL: `/api/rooms/{slug}/calendar/{token}.ics`. Calendar apps cannot sign in, so the URL carries the secret — the private-address pattern Google Calendar uses.

Addressing a *room* was the obvious first move and the wrong unit. A rider in four rooms subscribes four times, re-subscribes when they join a fifth, and gets a stale entry in their calendar list when they leave one. Worse, the affordance was rendered inside the lounge's planned-session card, which only exists when a session is already planned — so the answer to "where do I subscribe" was "plan something first". Riders reported not being able to find calendar URLs at all.

The unit riders actually think in is "my sessions". That crosses rooms, which is new: no other WattRoom surface aggregates across rooms behind a single unauthenticated URL. Metrics are room-scoped by architecture and stay that way.

## Decision

Riders get their own feed token (`users.ics_token`) and their own URL, `/api/calendar/{token}.ics`, listing planned sessions in every room they are a member of. Membership is resolved **on read**, so joining or leaving a room changes the feed without re-subscribing. This is the feed the UI offers first.

Room feeds stay exactly as they are. They address a different subject — a club's schedule, shareable with people who are not members — and existing subscriptions must not break.

Planned sessions are the only thing either feed carries. Metrics, ride history, and room membership lists are not calendar data and never enter a feed.

## Consequences

- One subscription per rider, for good. The `/sessions` page is where the URL lives, alongside the planning it mirrors.
- A leaked rider URL reveals more than a leaked room URL did: what you plan to ride, when, and which rooms you are in — a membership list by implication. Accepted, with the same escape hatch (`POST /api/calendar/rotate`, owner-equivalent, instant) and the warning stated on the page rather than buried.
- Two feeds mean two handlers over one `icsEvent` builder. The cross-room query is also what `/api/schedule` serves, differing only in horizon — the feed keeps a month of history, the page starts at the 30-minute grace.
- The tokens are separate on purpose: rotating your own feed must not break a room's, and a room owner rotating theirs must not break every member's.
- Revisit if feeds ever need to carry something a member can see but a link-holder should not — that is the point where the bearer URL stops being sufficient and the feed needs per-subscriber scoping.
