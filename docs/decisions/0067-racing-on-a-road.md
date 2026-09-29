# 0067 — Racing on a road

- Status: accepted; settles [#3167](https://github.com/natrontech/wattroom/issues/3167)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §1 — "no racing simulation"; §2's Game modes row gains races; both marked
- Keeps: [0048](0048-the-riders-numbers-are-asked-for-and-a-guess-says-so.md) — ask for a number, never gate on it
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (a race is one of the five modes), [0074](0074-a-time-is-yours-when-your-watts-moved-your-dot.md) (race placings are never stored), [0076](0076-shared-roads-not-an-open-world.md) (open rides), [0077](0077-the-wind-is-shared.md) (shelter), [0084](0084-wattroom-shifts.md) (gears)
- Decided by Jan: races on W/kg physics, bracketed by the SPEC categories D–A (2026-09-26); the commissaire's tap and an open field (2026-09-29, taking the recorded recommendations)

## Context

WATTROOM.md ruled out racing simulation. On 2026-09-26 Jan put races on a road
into Ride Worlds, on one condition: W/kg physics, bracketed by Category, so a
heavy rider does not win by existing and a light one does not lose by it.

W/kg everywhere makes weight the one number a rider can shade, and the FTP a
race is scored against is the other. A race is only fair if both are frozen
when the flag drops, and only honest if a number the rider never set cannot
place them.

## Decision

### Races are game modes, and opt-in

- A race is a **game mode**: a rule module over the same engine
  (WATTROOM.md §2's Game modes row).
- **Opt-in.** A rider who never chose racing never sees a race's results or
  its prompts.

### W/kg everywhere

- Each rider's speed is the **reference rider's** speed at that rider's
  **W/kg × 75 kg**, plus an **8 kg bike**, on the grade. Weight never buys
  speed on the flat, nor costs it on a climb.
- **The field is open.** Riders of any Category shelter each other
  (ADR-0077), and results stay per Category. Handicap starts and the co-op
  modes are the answer for a mixed crew.

### The numbers are frozen at the flag

- **Race FTP** = the profile FTP, or SPEC's FTP suggestion when that is more
  than 2 % higher — the existing rule, cited rather than restated — **frozen
  at the flag**.
- **Race weight is frozen at the flag.** A weight changed within 14 days, or a
  weight or FTP from the default source (ADR-0048), rides **unranked**.
- **The commissaire's tap.** A rider who races confirms their weight once
  every 90 days, with one tap through the existing FTP prompt (#3169). It is
  never a gate: a weight not confirmed within 90 days rides unranked.
- "Don't make me shift" rides are untimeable (ADR-0084, ADR-0074), and so are
  unranked.

### Results live on the closing card

- Results appear **per Category D–A on the closing card**, and only there. A
  lone rider's bracket reads "rode alone in C".
- **A restart voids the race.**
- **Race placings are never stored** (ADR-0074).
- **On an open ride** (ADR-0076), each rider sees **only their own placing,
  once**, on the closing card. The freezes, the unranked rule for default
  numbers and "a restart voids" all apply.

The numbers are in docs/SPEC.md's "Races" section.

## Consequences

- A race on a road is winnable by W/kg, not by kilograms, and the numbers it
  was scored against cannot move once it starts.
- A rider who never set their weight, or changed it last week, still races —
  unranked, and told so.
- Nothing about a race outlives its closing card, so there is no ladder to
  climb and no history to protect.
- WATTROOM.md §1's "no racing simulation" and §2's Game modes row are marked.
- Implementation: [#3032](https://github.com/natrontech/wattroom/issues/3032),
  [#3168](https://github.com/natrontech/wattroom/issues/3168) (the freezes),
  [#3169](https://github.com/natrontech/wattroom/issues/3169) (the tap).
