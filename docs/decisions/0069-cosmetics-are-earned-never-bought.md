# 0069 — Cosmetics are earned, never bought

- Status: accepted; settles [#3150](https://github.com/natrontech/wattroom/issues/3150)
- Date: 2026-09-29
- Reaffirms: WATTROOM.md §2's Money row — donations only, no paid tiers
- Diverges from: WATTROOM.md §1 — "no content treadmill"; marked there
- Beside: [0047](0047-deleting-a-ride-keeps-its-xp.md) (a deleted ride keeps what it earned), [0049](0049-ftp-history-is-the-ride-time-record.md) (the FTP a ride was ridden at), [0062](0062-the-horizon-may-be-a-road.md) (what a ride pays), [0073](0073-the-rider-is-dressed-never-measured.md) (the figure is dressed)
- Decided by Jan: a garage of cosmetics paid in **Batzen**, earned from riding (2026-09-26); invented makers with real parts (2026-09-28)

## Context

Ride Worlds gives the rider a figure on the road and a bike under it, and a
garage to choose them in. Everything around games like this pulls one way:
sell the items, make them random, make them expire, give them stats, pay a
daily log-in. Each of those turns a training app into a slot machine, and
WattRoom's riders include minors (the terms ask anyone under 16 to ask a
parent first).

WATTROOM.md's Money row says donations only. The garage has to hold to that
without a loophole, and to stay a place a rider enjoys rather than a chore.

## Decision

### Five rules that are never broken

1. **Never bought.** No item, and no Batzen, is ever sold for money.
   WATTROOM.md's Money row stands.
2. **Never traded or gifted.** What a rider earned is theirs alone.
3. **Never random.** No boxes, no draws, no odds. A rider sees what an item
   is and what it costs before they take it.
4. **Never expiring, never reset.** An owned item stays owned. Seasonal items
   return every year, so missing a window loses nothing for good.
5. **Never performance.** No item has a stat. Nothing from the garage enters
   the physics, a bunch's offsets or a result.

### Batzen

- The currency is **Batzen**: one Batzen is **one minute ridden at your own
  FTP** — `kJ × 1000 / (FTP × 60)` — so a lighter or less fit rider earns at
  the same pace for the same effort. The FTP is the one the ride was ridden at
  (ADR-0049). Seconds at zero watts earn nothing.
- Batzen are capped per hour and per day, and existing riders get a capped
  opening grant. The numbers are in docs/SPEC.md's wardrobe section
  ([#3151](https://github.com/natrontech/wattroom/issues/3151)).
- Batzen keep **their own ledger**, separate from `xp_events`. Spending them
  never touches XP, whose rows stay at or above 0 and all raise the level.
- **A deleted ride keeps its earnings**, as it keeps its XP (ADR-0047).
- **No daily-login loops and no FOMO**: nothing pays for showing up to the app,
  only for riding, and nothing is gone for good.

### What is on the shelf

- **Real parts, invented makers.** A frame, a wheel, a kit is a real kind of
  thing, from a maker WattRoom made up. The names ship after a trademark
  check ([#3253](https://github.com/natrontech/wattroom/issues/3253)).
- **Price the idea, not the parameter.** Width, depth, length, height, count,
  lens category and colour are free to change on anything owned. A rider buys
  a kind of thing once, then makes it theirs.
- The catalogue is **combinatorial**: parts combine, rather than a stream of
  new items to chase.

### The only terms a partner pack could take

If a real maker ever offers a pack, these are the only terms it can have:

- **no money either way** — neither paid to WattRoom nor by it;
- a perpetual licence for items riders own;
- its assets live outside the AGPL repository;
- no stats, no links, no tracking and no rotation.

## Consequences

- A rider's garage says how much they rode, and nothing else: not what they
  paid, not what they were lucky to draw.
- The shop has nothing to sell, so nothing in it can ever be tuned to make a
  rider pay.
- "No money either way" is stricter than the Money row, which allows
  donations: a partner may not pay us for placement either.
- WATTROOM.md §1's "no content treadmill" is marked: the garage grows, but by
  combination and returning seasons, never by items that expire.
- Implementation: [#3152](https://github.com/natrontech/wattroom/issues/3152)
  (the ledger and the shop), [#3151](https://github.com/natrontech/wattroom/issues/3151)
  (the numbers).
