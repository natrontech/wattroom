# ADR-0012: Friends — mutual only, formed in rooms, presence stays room-bounded

Date: 2026-08-31 · Status: accepted (#147)

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
