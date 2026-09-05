# ADR-0012: Friends — mutual only, formed in rooms, presence stays room-bounded

Date: 2026-08-31 · Status: accepted (#147)

> **Amended by [ADR-0024](0024-social-profiles.md) (2026-09-02):** a shared
> room is a formation path again, beside the friend code. The "formation by
> friend code only" amendment below is no longer the last word on how a
> request forms; ADR-0024 is.

## Context

Every privacy rule in WATTROOM.md is room-scoped by construction. A friends
list ("who's around right now") is the first feature that shows presence
*outside* a room — visible-by-default personal data with no room to scope it
to. #147 requires the visibility questions answered before code.

## Decision

**Formation — mutual, and only through a shared room.** You can request
someone as a friend only if you currently share a room membership; the
picker offers exactly those people. There is no global user search and no
handle lookup — a stranger cannot find you, address you, or spam you.
Friendship exists when the other side accepts. Either side can remove it at
any time; removal is silent and immediate.

**Visibility — accepting IS the opt-in.** Only accepted friends see
anything. What they see:

- a boolean: connected to a room right now, or not ("online" = in a room —
  WattRoom has no ambient presence, ADR-0010);
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
