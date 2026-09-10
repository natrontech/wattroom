# ADR-0025: One sensor, one screen — the hub arbitrates a claim it cannot hold

- Status: accepted
- Date: 2026-09-03
- Extends: [docs/ARCHITECTURE.md](../ARCHITECTURE.md) seam 1 (the client owns the trainer) and seam 2 (the tick is one message per room per second)

## Context

A rider with a trainer paired on their phone opens the room on their desktop and is offered "Pair trainer" again (#610). Nothing says the trainer is already in use, and nothing stops the second pairing.

The hub has always accepted several sockets per rider on purpose — `TestRosterDeduplicatesRiders` pins it, and `leave` only forgets a rider's metrics when their *last* socket goes, so a phone closing cannot blank the desktop's tile. Presence counts people, not sockets.

Live samples, though, are keyed by rider id alone. Two paired screens do not merely overwrite each other once a second. `seq` is minted per page session, so the two counters interleave; the accumulator reads a lower seq than it has already seen as evidence of a *new stream* (`accumulator.go`, the reload/re-pair case from #522), stops deduping, and appends both screens' samples into the one rider record. The ride gets double the samples, and the live execution score — the thing WATTROOM.md puts on the group dashboard — is computed over them. The fairness layer takes no doubles.

So this is not a tidiness problem about a redundant button.

The obvious fix is not available: a Web Bluetooth grant belongs to the browser that made it and cannot be handed to another device. "Paired on all my devices" is not implementable and this ADR does not pretend otherwise.

## Decision

The browser keeps owning the connection. The hub owns the **claim**: per room, per rider, per sensor kind, exactly one holding screen.

- A socket reports `SensorClaim` — the kinds it currently holds, a client-minted per-tab label, and a coarse device word ("phone", "tablet", "desktop"). Always the whole set, never a delta, so a message lost to a reconnect cannot leave a sensor claimed by a screen that let go of it.
- **First claim wins.** The hub answers with `SensorPairing`: what this socket was granted, and for everything else the device word of the screen that has it. A refused claim is how a tab learns not to render a trainer it never got.
- `setMetrics` takes samples only from the screen holding the `trainer` claim. A rider with **no** claim at all rides exactly as before, so an older client is never silenced.
- Claims are released when the owner drops the kind, and when its socket closes.

Two properties are deliberate.

**The answer is addressed to one rider, and stays off the tick.** What a rider straps on is nobody else's business, so it never enters the room-wide broadcast — the privacy rule in WATTROOM.md is about metrics, and this is the same instinct applied one step earlier. It also keeps seam 2 intact: the tick carries state that changes every second, and a claim changes when somebody pairs. The message is written by the tick goroutine (the only writer per socket) but is its own `ServerMessage`.

**The claim is keyed by tab, not by socket.** A reload opens a new socket while the old one is still registered — the hub reaps it only when its read loop returns. Keyed by socket, a refreshed tab would be "another device" and would sit locked out of the trainer it is still physically connected to. The tab label makes it its own successor.

**First-wins, where the AV path uses newest-wins.** `room/tabs.ts` hands the microphone to the newest claimant, because a mic moving between tabs costs nothing. A trainer is equipment somebody is riding: letting a phone that just woke up take it would drop the ERG targets of a ride in progress. Releasing is the holder's own act — Forget, or closing the tab.

## Consequences

- The double-counted ride record and the inflated execution score are gone, and pinned by tests rather than by hoping nobody opens two tabs.
- Every screen of a rider shows the same equipment state, and the ones that do not hold a sensor say which one does instead of offering a pairing that would be refused (`ux.md`: say why, never a dead click).
- **The claim is room-scoped, because the hub's live state is.** Two devices that are not in the same room are not coordinated. Covering that needs user-level presence — the lobby socket is the only door, and it deliberately carries no data. Accepted: the reported case is a phone and a desktop in one room, and a rider pairing a strap outside a room has nothing to conflict with yet.
- The solo screens (`/ride`, `/ramp`) hold no room socket, so they have no claim and behave exactly as before. A rider who pairs there and then joins a room claims on the way in.
- A rider whose phone dies mid-ride keeps the claim until the socket closes — seconds, on a TCP timeout at worst. Not free, but a claim that expired on a timer would be worse: it would hand the trainer away from a rider who is still pedalling.
- The device word is coarse on purpose. It is a hint about which screen to walk to, and anything narrower would be a fingerprint bought for nothing.
- A fourth kind, or a second trainer, extends the same map; an unknown kind is dropped rather than stored, so an older or newer client cannot grow the per-rider map past the four kinds.

## Amendment — the claim covers actuation too (2026-09-10, #1853)

The decision above arbitrated the **sample stream** and the pairing
affordance, and said nothing about the control point. So it half-worked:
`setMetrics` took samples from one screen, while both of a rider's screens
went on writing ERG targets to the trainer they were each still connected to.
Usually the same watts — until the two tabs' per-tab `bias` differed, and then
they fought at 1 Hz over the resistance of a ride in progress.

**A screen without the `trainer` grant does not write the control point.** It
keeps everything else: the GATT link, the samples it renders, and *Forget*.
Refusing the claim was always meant to make one screen authoritative, and half
a claim is a bug rather than a scope boundary.

The two alternatives are rejected for the same reason each way round.
Documenting the fight as a consequence leaves the trainer arbitrated for
reading and unarbitrated for writing. Making the refused screen *release* the
trainer recreates exactly what "first claim wins" ruled out above — a phone
that just woke up would drop the ride's targets, only now by disconnecting
rather than by stealing.

Two details this commits to:

- **Zeroing is an actuation.** *Forget* on a refused screen drops its own link
  and writes nothing, so it cannot release a target the driving screen holds.
- **A grant regained re-asserts the current target immediately**, rather than
  waiting for the next natural change. ERG holds the last value written, so a
  gap leaves the trainer on a target as stale as the gap was long; the
  known cost of this amendment is that stale target, never an absent one.

The client says the hub's own rule (`ownsTrainerLocked`) rather than a
stricter one, because the hub cannot refuse a Bluetooth write it never sees:
a claim held by **another** of the rider's screens refuses this one, and
anything else rides as before. A screen whose answer has not arrived, or whose
socket is down, therefore keeps its resistance — nothing is contending for the
trainer, and silencing it would be the ADR's own "drop the ERG targets of a
ride in progress" arriving by a new route.
