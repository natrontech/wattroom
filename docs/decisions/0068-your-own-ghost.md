# 0068 — Your own ghost

- Status: accepted; settles [#3122](https://github.com/natrontech/wattroom/issues/3122)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §2's Replay row — "Out"; a narrow carve-out, marked there with each widening
- Keeps: [0036](0036-what-a-room-shows-about-its-members.md) — what a crew sees of its members is opt-in; AGENTS.md — no Strava data
- Beside: [0082](0082-a-climb-belongs-to-the-map.md) (a line on a stretch), [0083](0083-the-road-board.md) (board lines), [0074](0074-a-time-is-yours-when-your-watts-moved-your-dot.md) (only your own watts), [0077](0077-the-wind-is-shared.md) (nothing shelters from a ghost)
- Decided by Jan: shared roads, option C (2026-09-28) — ghosts and crew lines on climbs from any route; the pacer approved on 2026-09-29, taking the recorded recommendation ([#3281](https://github.com/natrontech/wattroom/issues/3281))

## Context

WATTROOM.md closed replay: the ride summary is the record, and AV is never
recorded. That was about watching a ride back. Ride Worlds raises a narrower
thing: riding a climb beside your own last attempt at it, the most useful
pacing aid a rider alone has, and one that shows nobody anything new.

## Decision

### What a ghost is

- A **ghost** is a recorded line ridden again beside you (ADR-0082's "line").
  It is read only from **WattRoom-recorded** samples. **Never Strava data.**
- Ghosts belong to **climb stretches from any route** (ADR-0082): your
  **90-day best**, else your **last**, on any file that rides the climb. The
  **whole-route ghost** stays for a road with no matched climb.

### At most three at once

1. **Yours.**
2. **One crewmate's line**, if the crew turned crew lines on: a per-crew switch
   shaped like `on_board`, **off by default**, with a "Keep it private" undo
   per climb. Only each crewmate's 90-day best per stretch, labelled by ISO
   week (#3282).
3. **One unnamed board or record line**, if the rider picked it (ADR-0083).

### Where ghosts appear

- **Only where your own watts move your dot**: a solo route ride, a road step,
  a free ride on a road. **Never** in a session, a bunch, a race, a game, an
  ERG workout or a tow.
- **Only you see yours.**
- Ghosts are drawn **without watt, neon or glow** (ADR-0072): they are not live
  data. A ghost never shelters anyone (ADR-0077).

### The pacer

A **pacer** rides **solo route rides only**, at the par W/kg of the Category
the rider picks (#3281). It is the fallback behind your own ghost and a
crewmate's line. Never in a session, bunch, race or game; never a spectator's
to steer; never a source of shelter; never paying anything for riding near it.
**Bots never enter crew rides.**

## Consequences

- A rider alone has someone to ride against on every climb they have ridden
  before, and on the ones they have not, if their crew shares its lines or they
  pick a board line or the pacer.
- Replay stays out for everything else: no watching a ride back, no video, no
  other rider's whole ride.
- WATTROOM.md's Replay row is marked, naming each widening: your own ghost, a
  crewmate's line, a board line and the pacer.
- Implementation: the ghost ([#3033](https://github.com/natrontech/wattroom/issues/3033)),
  crew lines ([#3282](https://github.com/natrontech/wattroom/issues/3282)), the
  pacer ([#3281](https://github.com/natrontech/wattroom/issues/3281)), drawing
  ghosts ([#3245](https://github.com/natrontech/wattroom/issues/3245)).
