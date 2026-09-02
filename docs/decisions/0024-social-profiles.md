# ADR-0024: A rider's page shows what rooms already see

- Status: accepted
- Date: 2026-09-02
- Amends: [ADR-0012](0012-friends-mutual-only-room-formed.md) — a shared room is a formation path again, beside the code

## Context

Riders asked for a page per rider — level, medals, activity, the Strava
shape (#449). Every privacy rule in WATTROOM.md is room-scoped: live
metrics only inside the room, rides private by default, no public
leaderboards. A profile is the first surface that gathers a rider's facts in
one place *outside* a room, so what it shows, and to whom, has to be decided
before it exists. `/dev/profile` (#457) proposed the split by looking at it;
this ADR fixes it.

## Decision

**A page exists only for people who already know you.** `GET /api/riders/{id}`
answers to a signed-in viewer who shares a live room membership with the
rider, holds an accepted friendship, or has a pending request *from* them;
everyone else gets a 404 — the same 404 an unknown id gets, so the endpoint
confirms nothing. A request you sent by code is not a door: ADR-0012's code
grants "may ask", not "may look". There is no public web profile and no
crawler-facing route; the address is `/u/{id}` behind sign-in like everything
else (ADR-0009).

**Everyone the page opens to sees what a room already shows them.** Name,
avatar, level and lifetime XP, total energy (the sum of ride kJ), ride count,
account age, the rooms you have in common, and medals — but only the medals
earned in rooms you share. The roster already carries the level chip and the
room's medal history already lists those medals; the page collects them,
it does not extend them. A medal from a room the viewer is not in stays in
that room.

**Where they are follows the friends list's rule.** A friend sees online, "in
a room", and the room's name only when the viewer is a member of it
(ADR-0012). A room-mate who is not a friend sees only the rooms in common —
they would see the same person in that roster — and nothing about any other
room or the lobby. "Riding" is the equalizer bars (ADR-0020), never a number.

**Friends additionally see what the rider chose to share.** Rides stay
private by default (WATTROOM.md); each ride carries a per-ride switch, off
until the rider flips it, and a flipped ride appears on the page for accepted
friends with its workout, duration, energy, execution and any medal it won.
The room a shared ride was ridden in is named only to members of that room —
the rider can share their ride, not the room. Friends also get the month's
totals (rides, time, energy) because "how is their winter going" is the
question a friend actually has, and sums leak nothing a single ride would not.

**Never, to anyone: live watts, heart rate, weight, FTP, w/kg.** Watts and
heart rate are live-in-room only (ADR-0008); weight and FTP are what a
roster tile shows *its own room* for the w/kg column (#207) and they do not
travel out of it. A profile is identity and history, not a physiology sheet.

**Add a friend from the page — without carrying the code.** A room in common
is a formation path again: `POST /api/friends {userId}` succeeds only across a
shared room, restoring ADR-0012's original rule beside its code amendment.
The rider's friend code never leaves the server to a room-mate; a code is
theirs to hand out, and a JSON field that every room-mate can read would let
anyone pass it on to strangers.

## Consequences

- One new endpoint and one new query file; the ride switch reuses the
  `rides.shared_at` column the schema has carried since day one for exactly
  this, so there is no migration and nothing for ADR-0019 to contract later.
- The members list, the friends list and the DM header link to the page;
  #448's "click a member, add them" is this page plus the id path.
- The rider's own page renders through the same endpoint (`friend: "self"`),
  so what you see is what a friend sees — the honest preview.
- No block list still (ADR-0012's ponytail): a room-mate can ask once, a
  dismissed request can be re-sent. The ceiling is unchanged by this ADR.
- Revisit trigger: a request for a public share link of a ride. That is a
  different artifact (the `og` package's territory), not a widening of the
  page.
