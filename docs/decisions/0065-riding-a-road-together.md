# 0065 — Riding a road together

- Status: accepted; settles [#3093](https://github.com/natrontech/wattroom/issues/3093)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §1 — "no racing simulation, drafting physics or game mechanics"; marked there for the bunch
- Keeps: [0036](0036-what-a-room-shows-about-its-members.md) — riding together is never ranked; [0056](0056-a-crew-pins-what-it-keeps-needing.md) — unchanged by a crew's home road
- Beside: [0052](0052-a-room-ride-the-server-loses-comes-back-from-the-browser.md) (a restart), [0062](0062-the-horizon-may-be-a-road.md) (the bunch ride and what "riding" means on a road), [0063](0063-a-route-keeps-its-place-with-care.md) (what the hub may hold), [0076](0076-shared-roads-not-an-open-world.md) (open rides)

## Context

ADR-0062 makes the **bunch ride** one of the five modes: a session riding one
road together. Riding together is the point of WattRoom, and on a road it needs
one thing a workout never did: a **place** on the road that everyone shares.

Two ways fail. If every rider's dot moves by their own watts, the crew is
strung out across the valley within minutes and nobody is riding together. If
the bunch moves at the live mean of everyone's watts, it drifts: a synthetic
crew paced that way drifted about 1.5 %, roughly 450 m an hour, and one strong
rider tows everyone. Zwift's answer is a keep-together speed well below what
anyone rides free (27.6 km/h at 225 W against about 36 km/h, Zwift Insider,
2024-02-14).

## Decision

### One bunch position, owned by the hub

- The hub owns **one bunch position** and advances it **once per whole
  second**, never on the 4 Hz burst ticks of a sprint window (#1580).
- The bunch engine takes **riders and a plan**, not a room. A session drives
  it, and so does an open ride (ADR-0076); it is never ranked in either.
- The hub holds **heights, never coordinates** (ADR-0063).

### What pace the bunch rides

| The plan is                            | The bunch moves at                                                        |
| -------------------------------------- | ------------------------------------------------------------------------- |
| an ERG workout, or a workout on a route | the reference rider at the block's **prescribed** %FTP                    |
| a sprint block                         | the reference rider at **150 %**                                          |
| paused                                 | nothing: the bunch slows to 0                                             |
| a road step                            | the live mean %FTP of the pedalling riders, each capped at **150 %**      |

**Bias is never used.** It is personal (a rider's own trim, #795), and one
rider's trim must not move everyone's road.

### Everyone stays in it

- On a road, a rider is riding while their virtual speed is above 0.5 m/s
  (ADR-0062).
- Each rider's place is an **elastic offset** from the bunch position: ride
  harder and you move up it, ease off and you drift back. **Nobody is ever
  removed** from the bunch; a rider who stops is carried back to it.
- **Riding together is never ranked** (ADR-0036): no gaps, no positions, no
  "dropped".
- **There is no drafting in the bunch**, and no power-ups. Drafting on a road
  is ADR-0077's, for races and free rides.

### A crew's road

- A restart (ADR-0052) re-picks the route with its `fromM`, so the bunch comes
  back where it was.
- A crew's **home road** is a crew setting, not a pin; ADR-0056 is unchanged.

The offsets, their decay and the rest of the bunch's numbers are in
docs/SPEC.md's "Riding a road together" section.

## Consequences

- A crew rides one road at a pace the workout sets, so a strong rider cannot
  tow the bunch away and a weak one is never left behind.
- A power model now moves a shared position, which WATTROOM.md §1 ruled out as
  simulation. It is marked there. There is still no drafting in the bunch and
  nothing to win.
- The engine's inputs are riders and a plan, so an open ride reuses it
  without a second implementation.
- Implementation: the bunch position on the tick
  ([#3028](https://github.com/natrontech/wattroom/issues/3028)), resuming at a
  kilometre ([#3103](https://github.com/natrontech/wattroom/issues/3103)), the
  numbers ([#3094](https://github.com/natrontech/wattroom/issues/3094)).
