# ADR-0012: Friends — mutual only, formed in rooms, presence stays room-bounded

Date: 2026-08-31 · Status: accepted (#147)

> **Amended by [ADR-0024](0024-social-profiles.md) (2026-09-02):** a shared
> room is a formation path again, beside the friend code. The "formation by
> friend code only" amendment below is no longer the last word on how a
> request forms; ADR-0024 is.

## Context

Every privacy rule in WATTROOM.md is room-scoped by construction. A friends
list ("who's around right now") is the first feature that shows presence
_outside_ a room — visible-by-default personal data with no room to scope it
to. #147 requires the visibility questions answered before code.

## Decision

**Formation — mutual, and only through a shared room.** ~~You can request
someone as a friend only if you currently share a room membership~~
**Diverged 2026-09-10 (#1650, ADR-0038)**: a room your crew can open counts, whether or not either
of you has entered it — see ADR-0024's amendment of the same date for the argument. The
picker offers exactly those people. There is no global user search and no
handle lookup — a stranger cannot find you, address you, or spam you.
Friendship exists when the other side accepts. Either side can remove it at
any time; removal is silent and immediate.

**Visibility — accepting IS the opt-in.** Only accepted friends see
anything. What they see:

- a boolean: ~~connected to a room right now, or not ("online" = in a room —
  WattRoom has no ambient presence, ADR-0010)~~ **Diverged 2026-09-10 (#653, #1398)**: "online"
  means the app is open — the lobby socket — as a state of its own beside *in a room* and
  *riding*. Amended in full below (2026-09-09); this line is what a reader hits first;
- the room's name and a join affordance **only when the viewer is a member
  of that room**. Otherwise just "riding elsewhere". The room stays the
  privacy boundary; friendship never pierces it.
- never metrics, never ride history, never voice/camera state.

**No invisible mode, no per-friend tiers** (95% rule): the control is
having accepted the friend. Remove them and they see nothing again.

**Requests**: pending requests show to both sides; the addressee accepts or
dismisses. Dismissing deletes the request; the requester just sees it
pending no more.
<!-- ponytail: no block list — the shared-room gate already limits requests
     to people you chose to share a room with. Add blocking when rooms grow
     past hand-picked crews. -->

## Consequences

- Server: a `friendships` table (requester, addressee, status
  pending/accepted), REST endpoints under `/api/friends`, and one hub
  question — "which room is this user connected to" — answered from live
  state, nothing persisted about presence.
- The alpha crew already shares rooms, so formation-through-rooms costs
  them nothing; it only constrains strangers, who are exactly who it should
  constrain.
- A removed friend can re-request (they still share a room with you, or
  they can't). Annoyance ceiling accepted for the alpha; blocking is the
  named upgrade path.

## Amendment — formation by friend code only (2026-08-31)

The roommate picker is gone. Every user gets a random 8-character **friend
code** (read-aloud-safe alphabet, like room codes); a request is created
only by entering someone's code — `POST /api/friends {code}`. Knowing the
code IS the permission to ask: the server never lists users as candidates,
roommates included, and the member card no longer offers "add".

- The shared-room gate falls with the picker: codes travel out-of-band
  (chat, voice, in person), so you can befriend someone before ever sharing
  a room with them.
- The anti-spam property survives in a different shape: a stranger still
  cannot find or address you. A code is unguessable in practice (16^8
  space) and grants only "may send a request", which the addressee accepts
  or silently dismisses as before.

## Amendment — direct messages, friends only (2026-08-31, #208)

DMs exist exactly where friendship exists: only an **accepted friend** can
message you — the gate is the friendship row, enforced in SQL on every
insert. Remove the friend and the channel closes with it.

- Same bounded-log shape as room chat: the last **500 messages per pair**,
  pruned on write; a deleted account takes its messages along (cascade).
- No read receipts, no typing indicators — "seen" is the reader's own
  business (client-side), never data about you held by the server.
- Transport is plain REST + polling; a DM is a note between rides, not a
  live wire. If DMs ever grow real-time needs, that is a new decision.

## Amendment — a dismissed request tells the requester (2026-09-06, #876)

The original decision had the addressee dismiss in silence: the request
simply stopped being pending, and the requester was left watching a row
that would never move. In practice that reads as a broken feature, not as
discretion — the rider cannot tell a dismissal from a request that never
arrived, so they wait, and eventually ask again. **A dismissal now reaches
the requester**, the way a request and an acceptance do: cue, toast, or an
OS notification on a hidden tab.

- The wording is the answer, not a verdict: "<name> dismissed your friend
  request". Said once, and never shown as a row — there is nothing left to
  act on.
- **The dismisser is not exposed further.** The requester learns that their
  ask was answered, which they could already infer by asking again; they
  learn nothing about the other rider, and nothing reaches anyone else.
- Storage is a `friend_declines` tombstone (requester, addressee, time),
  written when the addressee deletes a _pending_ request they did not
  send. Cancelling your own ask and unfriending stay silent, exactly as
  before — the same DELETE, three different meanings, decided by who owns
  the pending row.
- The tombstone is cleared whenever the two of them form a request or a
  friendship again, in either direction, so an old dismissal cannot
  resurface on a device that had never heard it.

## Amendment — online means the app is open (2026-09-09, #1398)

The decision above says a friend's presence is "connected to a room right now, or not", and that "online" means in a room. Since #251 (the lobby socket) and #807 that is no longer what the code says or what a friend sees: `friends.go` reports **online** as "the app is open" — the lobby socket is up, Slack's green dot — as a state of its own beside **in a room** and **riding**. This amendment records that as decided, because the ADR exists to be the privacy record for the first presence that leaves a room.

Why it is acceptable: it is still friends-only (mutual, formed by code, never a listing), still a boolean with no metrics behind it, and still says nothing about what you are pushing; the room is named only when the viewer is a member of it (`friends.go`). ADR-0010's "no ambient presence" deferred a global surface for strangers; an accepted friend seeing that you are around is the thing a friend list is for. What has not changed: room-scoped metrics, nothing recorded, and a friend who wants to be invisible has the same answer as before — close the app.

**What "close the app" rests on (#1506, #1740, #2087).** Presence derived from a live socket is only honest while the server can tell the socket apart from a dead one, and a laptop that sleeps, a NAT that drops or a phone that loses signal closes nothing the server ever hears. So both sockets — the lobby's and each room's — ping their peer every **30 s** and are dropped when the pong does not come back within **5 s** (`server/internal/hub/keepalive.go`); the rider then reads offline, leaves the roster, and gets their socket budget back. This is the mechanism, not a new decision: no timestamp is stored, nothing is persisted, and the boolean a friend sees is unchanged. The alternative — last-seen timestamps — stays rejected: it would record presence, which is exactly what this ADR says the server does not do.
