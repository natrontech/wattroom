# 0077 — The wind is shared

- Status: accepted; settles [#3232](https://github.com/natrontech/wattroom/issues/3232)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §1 — "no … drafting physics"; marked there
- Beside: [0065](0065-riding-a-road-together.md) (no drafting in the bunch), [0067](0067-racing-on-a-road.md) (the open field), [0074](0074-a-time-is-yours-when-your-watts-moved-your-dot.md) (a sheltered effort is untimeable), [0076](0076-shared-roads-not-an-open-world.md) (open rides), [0084](0084-wattroom-shifts.md) (the one SIM composer, and no pulse)
- Decided by Jan, 2026-09-28: drafting in races and in free rides on a road — shelter computed by the hub, capped at 50 %, no steering, felt through Cw in SIM with an off switch under Advanced, never in ERG or a workout, and an effort above 5 % mean shelter untimeable

## Context

WATTROOM.md ruled out drafting physics. Without a draft, though, the races of
ADR-0067 are parallel time trials that the highest W/kg wins at the flag, and
riding a road with a friend is two people who never help each other. Jan
reopened the question on 2026-09-27 and answered it the next day.

A draft is only fair if everyone agrees where everyone is. At 35 km/h, under
a 1 Hz tick and the 500 ms pedal-to-screen budget, another client's position is
5–10 m stale, which spans the whole 0–6 m shelter band. A draft each client
computed for itself would yo-yo, as MyWhoosh's did.

## Decision

### Where the wind is shared

- **Only where a rider's own watts move their own position**: in races, and in
  free rides on a road.
- **The hub computes shelter** for both, with one engine
  ([#3032](https://github.com/natrontech/wattroom/issues/3032),
  [#3117](https://github.com/natrontech/wattroom/issues/3117)). A client never
  computes its own.
- **Never** in the ERG bunch (ADR-0065), a road step, a %FTP game mode or the
  Col; never from anything bought or earned; never from a bot, a ghost or a
  pacer, or from a rider who is quiet or being towed.
- **On an open ride** (ADR-0076) the group ride has no shelter, like the ERG
  bunch. Open-ride race formats follow this ADR, and because the hub computes
  every position, a stranger's shelter is as honest as a crewmate's.

### What the hub does, and never does

- **No steering.** Lanes are automatic, with an always-open passing lane.
- **The hub never brakes and never clamps**: extra watts always move a rider
  forward.
- Shelter is **capped at 50 %**.
- **No power-ups, ever.** Crosswind echelons wait for an ADR of their own.

### Timing and categories

- **An effort whose mean shelter exceeds 5 % is untimeable**, in free rides
  and races alike (ADR-0074, which already reads this rule). A crew's climb
  times read only timeable efforts (#3147).
- **The field is open** in a race: riders of any Category shelter each other,
  and results stay per Category (ADR-0067). A bracket of one still has a podium
  of one. Handicap starts (#3172) and the co-op modes are the answer for mixed
  crews.

### On the trainer

- Shelter is felt through **FTMS Cw, only in SIM**, eased with τ 2 s, with an
  **off switch** under Advanced. The switch zeroes shelter in the trainer
  composer only; the rider's dot still gets the hub's shelter.
- **ERG never receives a Cw.**
- Cw composes as **k³ · Cw₀ · (1 − shelter)** in ADR-0084's one SIM composer.
  A gear shift is not a drafting write: it carries the current shelter and is
  exempt from the drafting write spacing. **Cw is never eased between gears**:
  that is the "smooth transition" of 18/640,559's published dependent claims 6
  and 13.
- **No resistance pulse is ever used** for surface or event feel (ADR-0084,
  rule 2, which defines a pulse). Every independent claim of Zwift's granted
  US 11,986,700 (active until about 2042-11-24) needs a simulated shift or
  braking made by "at least one rapid near-cessation of resistance";
  "temporarily altering resistance" was only the published application's
  wording.
- A patent search on drafting-to-trainer feedback is recorded before the
  trainer half ([#3235](https://github.com/natrontech/wattroom/issues/3235))
  merges.

The numbers are in docs/SPEC.md's "Drafting" section.

## Consequences

- A race on a road is a race: sitting in and attacking both matter, and a
  stronger rider can still ride away, because the hub never holds anyone back.
- Two friends on a free ride can take turns in the wind; an effort ridden
  mostly in the other's shelter is simply not timed.
- The hub now runs physics for races and free rides on a road. #3117's "no hub
  physics" line is amended to say so.
- WATTROOM.md §1's "no drafting physics" is marked.
- Implementation: [#3032](https://github.com/natrontech/wattroom/issues/3032),
  [#3117](https://github.com/natrontech/wattroom/issues/3117),
  [#3235](https://github.com/natrontech/wattroom/issues/3235),
  [#3048](https://github.com/natrontech/wattroom/issues/3048).
