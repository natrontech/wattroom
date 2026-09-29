# 0074 — A time is yours when your own watts moved your dot

- Status: accepted; settles [#3121](https://github.com/natrontech/wattroom/issues/3121)
- Date: 2026-09-29
- Amends: [0036](0036-what-a-room-shows-about-its-members.md) — crew climb times sit behind the weekly board's switch, on its terms
- Annotates: WATTROOM.md §2's Rank currencies row — "never raw watts"
- Keeps: [0027](0027-an-earned-badge-travels-progress-stays-home.md) (an earned badge travels, progress stays home), [0047](0047-deleting-a-ride-keeps-its-xp.md), and SPEC's XP rule (1 kJ = 1 XP)
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (the modes and `timeable`), [0063](0063-a-route-keeps-its-place-with-care.md) (location data is the owner's), [0065](0065-riding-a-road-together.md) (the bunch), [0076](0076-shared-roads-not-an-open-world.md) (open rides), [0077](0077-the-wind-is-shared.md) (drafting), [0084](0084-wattroom-shifts.md) (gears)

## Context

A road makes times: how long a climb took, how fast a stretch went. Times are
the most natural thing on a road to compare, and the easiest to get wrong.

A time only means something if the rider's own effort produced it. In ERG the
trainer holds the watts WattRoom asks for, so a climb time measures the
workout, not the rider — the reasoning that left the ramp test unscored
(#1400). In a bunch the hub moves one position for everyone, so a time belongs
to the crew. Shelter, a tow, a client that reports its own metres, a file
imported from elsewhere and a weight lowered the day before are all ways a
time stops being true. And WATTROOM.md ranks by W/kg, never raw watts.

## Decision

### Who chose the watts decides whether a time is timed

`timeable` is decided **per effort, by who chose the watts**, and written when
the ride is saved (ADR-0062):

| Effort                                                        | Timed?                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| a free ride on a road in SIM, at any difficulty               | yes — the rider's watts moved the dot                   |
| a solo road step                                              | yes                                                     |
| a race                                                        | yes                                                     |
| virtual gears on a Zwift Cog, or on real gears                | yes, like any SIM ride                                  |
| an ERG road workout, or a workout on a route                  | stored, never timed: the time measures the workout      |
| "Don't make me shift" (ERG by the road)                       | stored, never timed: WattRoom chose the watts (Jan, 2026-09-28) |
| a bunch ride                                                  | the crew's, as a cooperative record — never one rider's |
| an open ride                                                  | saved as bunch or race with `timeable` and `board_ok` false |

- **A gear never enters the pace model or timing.** Reported watts are never
  scaled (ADR-0084).
- **An effort whose mean shelter exceeds 5 % is untimeable**, and a towed
  stretch makes the whole ride untimeable (drafting is ADR-0077's).

### The server's replay is the only clock

- **Road times are computed by the server's replay** of the rider's watts on
  the map's profile (#3139, #3241), never from the metres a client sent.
- **An imported file never sets a road time**, whatever it contains.

### A time another rider can see has to be believable

`board_ok` gates every time another rider can see (#3248). It needs:

- a fresh save — recorded by WattRoom, not Strava-origin, not imported;
- an account at least 14 days old with at least 5 saved rides;
- a weight set at least 7 days before the ride, and not dropped by more than
  2 kg since;
- no jump beyond 110 % of the rider's own 90-day best at that duration.

The public road board also needs a ride the hub streamed live (ADR-0083).

### Where times may be ordered

- **Ordered times appear only behind ADR-0036's switch** and each rider's
  `on_board`: this week only, reset every Monday, bracketed by Category D–A,
  off until the crew's owner or an admin turns it on. This amends ADR-0036:
  the weekly board may carry climb times — fastest, and most ascents — beside
  its kJ and time ridden.
- **Location-derived stats are the owner's** (ADR-0063). A crew gets
  cooperative sums, never a list of where each member rode.
- **Flats are never boarded.** A climb time bracketed by Category is a rank in
  W/kg, which WATTROOM.md allows; a flat time would rank raw watts, which it
  does not.
- **Race placings are never stored.** A race's result lives on its closing
  card (ADR-0067).

### What does not change

- **XP stays 1 kJ = 1 XP**, with no bonus for climbing.
- An earned badge travels; progress stays private (ADR-0027).
- A time never comes from a group workout, as Zwift's HoloReplay never uses a
  PR set in one.

The numbers are in docs/SPEC.md's "Road times" section.

## Consequences

- A rider who sees a time can trust that the rider behind it pedalled it, on
  the map's road, at a weight they had set before.
- A new rider waits two weeks and five rides before any of their times shows
  to anyone else. That is the price of a board without moderators.
- Anything that shows a time names which gate it passed: `timeable` for the
  rider's own record, `board_ok` for anyone else.
- WATTROOM.md's "never raw watts" gets a dated note: climb times by Category
  are a rank currency, flats are not.
- Implementation: [#3139](https://github.com/natrontech/wattroom/issues/3139),
  [#3147](https://github.com/natrontech/wattroom/issues/3147),
  [#3248](https://github.com/natrontech/wattroom/issues/3248),
  [#3053](https://github.com/natrontech/wattroom/issues/3053) (the `timeable`
  column).
