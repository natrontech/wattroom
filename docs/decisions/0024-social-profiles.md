# ADR-0024: A rider's page shows what rooms already see

- Status: accepted
- Date: 2026-09-02
- Amends: [ADR-0012](0012-friends-presence.md) — a shared room is a formation path again, beside the code

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
answers to a signed-in viewer who ~~shares a live room membership with the
rider~~ **Diverged 2026-09-10 (#1650, ADR-0038)**: shares a room either may enter — see the
amendment below — holds an accepted friendship, or has a pending request *from* them;
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

## Amendment, 2026-09-10 (#1650): the audience is a room you may both enter

`SharesRoomOrFriends`, `ListRoomsInCommon` and the friend-request-by-id gate all read `visible_rooms`, which since [ADR-0038](0038-the-crew-is-the-layer-above-rooms.md)'s third amendment unions membership with *"a room open to its crew, and you are in that crew"* — and every new room is crew-visible. So two riders who joined a crew by its code and never entered a room can already see each other's page and trophy case, request each other by id, and get `roomsInCommon` naming rooms neither has joined.

**That is what ships, and it follows ADR-0038's thesis rather than contradicting it**: the crew is the layer above rooms, and permissions inherit into it. What went wrong is only that the audience change rode along unrecorded — the refactor's comment explains the view was adopted for ban correctness, which it was, and says nothing about who can now see a rider.

**The audience is therefore "a rider you share a room with, or could".** Recorded here rather than left implicit, because this ADR is the privacy record for the rider page and an unwritten widening is the one kind this ADR exists to prevent.

Deliberately not narrowed. #1650 offers a `RoomsSharedByMembership` query for the three gates while `visible_rooms` keeps room access, and that stays the option if the crew should *not* be the social boundary — but that is a change to ADR-0038's thesis, argued there, not a quiet re-narrowing here.

## Amendment, 2026-09-17 (#2239): the face is on the page, not beside it

`GET /api/riders/{id}/avatar` served a rider's uploaded photograph to **any**
signed-in account that held the id. No shared room, no friendship — the route
asked nothing beyond sign-in. The widening lived in a code comment ("the face
is what every roster, thread and friends list already shows") and in a test
that named the viewer a `stranger` and asserted 200. It was never written
here, which is the kind this ADR exists to prevent, so it is settled here.

**Narrowed: the picture answers the page's audience and nobody else.** The
route asks `SharesRoomOrFriends` — the same one question the page and the
trophy case ask (#2298, #2300) — and refuses with the page's own 404 and the
page's own sentence. Three routes, one audience, one refusal.

The comment's reasoning was true of the *surfaces* and false of the *route*.
A roster, a thread and a friends list each hand out a face only to someone
already looking at that room, that conversation or that friendship. The route
had no such context: ids travel, a chat backlog carries `fromId` for every
author, and one room-mate could therefore fetch the photograph of a rider who
had left months ago, or of anyone whose id they had ever seen anywhere. A 200
also meant "this id exists and has uploaded a picture", which the page next to
it declines to say.

**What a rider will notice.** Faces the viewer has no standing for become the
initial that `Avatar.svelte` already falls back to — the picture is the only
thing that changes, never a name, a row or a link. Nothing in the client builds
an avatar URL out of a bare id (`web/src/lib/people.svelte.ts`: "Nothing
fetches for this"); an address only ever arrives inside a payload whose own
route already gates. So the gate is one call in one handler, and only four
rendered surfaces sit outside the new audience — each of them the rule working
rather than a surface breaking:

- a crew-mate listed to a crew admin, who reads the whole crew
  (`ListCrewPeople` with `everyone`), when the crew holds no crew-visible room
  the two share;
- a `pending_out` request made by friend code across no shared room — ADR-0012's
  code grants "may ask", and this ADR already says an ask you sent is not a door;
- a crew-banned person in that admin's banned list, and a room-banned member in
  the room's members list: the ban is exactly what takes them out of
  `visible_rooms`.

Deliberately **not** on that list: the DM header and the conversation list. A
peer's face already leaves with the friendship — `ListDmHeads` joins an
accepted `friendships` row, which is #1814 ("the peer's current name, face and
level stop reaching someone the rider removed"), and the thread page learns a
face only from a rider page that answers. `dms.handleImage`'s "unfriending ends
the conversation, it does not black out the history" is about pictures already
*sent into* a thread, and a peer's own portrait was never one of those.

**Not narrowed with it: the audience itself.** This route now reads
`visible_rooms` like the other two, so the 2026-09-10 amendment above still
holds — a room you may both enter, crew-visible rooms and grants included.
