# 0062 — The horizon may be a road

- Status: accepted; settles [#3020](https://github.com/natrontech/wattroom/issues/3020)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §1 — "no roads" (the Vision paragraph and "What WattRoom is NOT") and "no content treadmill"; marked there
- Amends: [0046](0046-one-riding-surface.md) — slot 5 may be the road ahead; [0059](0059-a-voice-channel-rides-without-a-session.md) — the free ride gets a third mode and rides alone too
- Leans on: [0063](0063-a-route-keeps-its-place-with-care.md) (where a route's place is kept and who sees it), [0065](0065-riding-a-road-together.md) (a bunch), [0066](0066-the-world-is-the-ride-view.md) (the world), [0067](0067-racing-on-a-road.md) (a race), [0074](0074-a-time-is-yours-when-your-watts-moved-your-dot.md) (whose time it is), [0084](0084-wattroom-shifts.md) (virtual gears)

## Context

WATTROOM.md dropped the road on purpose: "a Zwift alternative that
deliberately drops the virtual world (no roads, no avatars, no 3D)". Between
2026-09-26 and 2026-09-28 Jan widened M11 into the Ride Worlds program (#99):
riders bring their own routes, the world becomes the ride view, crews ride a
road together, races ride on W/kg.

Every one of those rests on the same handful of facts, and they have to be
settled once, before any of it is built: what a road is to a workout, which
modes a rider sees, what "riding" means when there is a road, how the grade the
road has becomes the grade the trainer is sent, what a road ride pays, and what
a ride keeps. This ADR settles those. The rest of the program has its own
numbers, 0063 to 0084.

## Decision

### A workout may carry a road, by reference

A road enters a ride only as a reference to a stored route (ADR-0063), and the
server cuts it to its audience before it travels. A workout never embeds
coordinates or heights.

### One road, any mode

Riders see **five modes: Free ride, Workout, Bunch ride, Race, Game.** The road
is an attribute of any of them, never a sixth mode. Time trial, recon, climb
repeats and "ride with a friend" are entry points on the free ride, not modes.

How the road meets the trainer has four code names. They name code and docs;
no rider reads them.

| Code name    | What is ridden                                                                                  | Trainer                                   |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| route ride   | the free ride's third mode, beside watts and grade                                               | SIM, the road's felt grade                |
| road step    | a `road` step in a workout — SPEC's old `freeride` promise under its real name                   | SIM, the road's felt grade                |
| road workout | ERG blocks pinned to metres of the road                                                         | ERG                                       |
| scenery      | a workout on a route: blocks run by time and the road is only shown                              | ERG                                       |

A **bunch ride** is a session riding one road together, on one position the hub
owns (ADR-0065). It is a mode, not a game mode. A race is ADR-0067's.

ADR-0046's parity rule holds: a road mode a session has, a rider alone has too.

### A road workout ends a block at a distance

- A block ends when the rider reaches its `stepEndM`, not when a clock runs out.
- Bias still changes the watts, so on a road it stretches or shortens the ride
  rather than the effort.
- **Skip block** and **+1 min** are hidden on a road, with a one-line hint: the
  road decides where a block ends.
- Execution weights each block by the seconds actually spent in it.
- In a session the shared clock maps to metres through the **prescribed** pace,
  so one rider's bias never moves the shared timeline.

### Riding means moving

On a road, a rider is riding while their virtual speed is **above 0.5 m/s**.
Presence, auto-pause, auto-end and the recording rule all read this, and not
cadence or watts alone: a rider freewheeling down a descent is riding.

### The grade the road has, the grade the rider feels

- The stored road carries its own grade, clamped to −15 … +20 %.
- The **felt grade** is `difficulty × grade`, halved again on descents,
  clamped to −5 … +15 % and slewed at no more than 1 %/s. At the default
  difficulty, −6 % feels −1.5 %.
- **Difficulty** is 50 % by default and 100 % under Advanced. It never touches
  speed, time, XP or Batzen: the dot moves by the road's own grade, and only
  the legs feel less of it.
- **One ceiling.** `MaxTrainerGrade` in `protocol/limits.go` is **+15 %**, the
  free ride's shipped range, and both the free ride and the felt grade use it;
  there is no separate +10 %. `MinTrainerGrade` beside it, **−10 %** until
  hardware check P11 measures a trainer's descent, is the floor of the grade
  written. The felt floor stays −5 %; the room below it is for virtual gears
  (ADR-0084).
- Entering a road writes 0 % for 500 ms before the road's grade.
- The pace model and FTMS share **one Cw**: the one `ftms.ts` sends. A hardware
  session measures whether it holds, and this ADR does not assert it.

The numbers are in docs/SPEC.md's "Route rides" section. No road number
appears in code before it appears there.

### What a road ride pays

A route ride is **unscored**, like the free ride it is a mode of.

| Ride                                                            | Execution bonus | XP                  | Batzen                           |
| --------------------------------------------------------------- | --------------- | ------------------- | -------------------------------- |
| A scored workout, on a road or not, alone or in a bunch          | yes             | kJ + streak + bonus | kJ at the FTP rate (ADR-0069)    |
| Every other ride: free, route, race, game, an unscored workout   | no              | kJ + streak         | kJ at the FTP rate (ADR-0069)    |
| Coasting, spectating                                            | —               | 0                   | 0                                |

Distance and descent pay nothing. Only work does, which keeps SPEC's fairness
rule: a road is never a faster way to a level.

### What a ride keeps

- Samples carry `m` (distance along the road) and `alt`.
- The `.fit` carries distance and altitude, **never a position**.
- `ride_mode` is one of `free | workout | bunch | race | game`, plus a
  `timeable` boolean written at save by ADR-0074's rule. The code names above
  are not stored modes.
- A **leg**, the stretch of a route ridden in one sitting, is at most 6 h.

### What changes in ADR-0046 and ADR-0059

- **ADR-0046**: slot 5, the horizon, may be the road ahead instead of the
  interval graph. Under a shared screen it becomes a 40 px strip.
- **ADR-0059**: the free ride has three modes — watts, grade and route — and it
  rides alone on `/ride` as well as in a voice channel.

Each file carries a dated amendment.

### Where WATTROOM.md stops being true

The Vision's "no roads" and "What WattRoom is NOT"'s "roads" are marked where
they stand. "No content treadmill (routes, …)" is marked too, for two reasons:
a rider's own imported routes are not a treadmill, but a **growing library of
famous climbs** is content WattRoom curates. That is a second, deliberate
divergence from the same line, taken by Jan on 2026-09-26.

These markers cover roads only. The world, avatars and 3D get theirs from
ADR-0066, and racing from ADR-0067, each in its own PR: the docs job fails a
link to an ADR file that does not exist yet.

## Consequences

- The engine has two clocks, time and metres, and a session converts one to the
  other through the prescribed pace. Anything that reads "block remaining" must
  say which one it reads.
- A GPX downloaded from strava.com rides owner-only (ADR-0063): never picked
  into a session or planned. Coordinates never reach an AI context.
- The glossary gains every Ride Worlds word in this PR, so later copy has one
  vocabulary: the 3D person on the road is a **figure**, a **rider** is the
  person and an **avatar** is their profile picture; the **geo pack** is the
  pmtiles file and a **corridor** is one route's enrichment; the bike
  computer's page table is `computer-pages.ts`, never a third `pages.ts`.
- Revisit: the Cw once the hardware session has measured it, `MinTrainerGrade`
  after P11, and the 50 % difficulty in alpha.
- Implementation: `$lib/road`
  ([#3023](https://github.com/natrontech/wattroom/issues/3023)), the road
  workout ([#3026](https://github.com/natrontech/wattroom/issues/3026)), the
  bunch position ([#3028](https://github.com/natrontech/wattroom/issues/3028)),
  a ride's road columns
  ([#3053](https://github.com/natrontech/wattroom/issues/3053)), a leg resumed
  ([#3103](https://github.com/natrontech/wattroom/issues/3103)).
