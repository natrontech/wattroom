# 0088 — Ship on research and simulation, not on the maintainer's hardware

- Status: accepted
- Date: 2026-10-25

## Context

Several gates waited for Jan to run something by hand: the Kickr sitting (#3350) held gears ([ADR-0084](0084-wattroom-shifts.md)) and the road's Beta marker ([ADR-0062](0062-the-horizon-may-be-a-road.md)); the slow-rig GPU run (#3082) held the world budget; checks on his own reference loop (#3414, #3581), the audio listening pass (#152), the desktop hardware passes (#1314, #3348), the Garmin import (#2330) and the ERG release check (#2658) each waited on him. Some had waited a month. Jan, 2026-10-25: "i don't want with hardware or your own stuff just do it that it works and then add it. with research or good tests or simulations. i don't have the time".

## Decision

No gate waits on the maintainer's hardware, rig, routes or ears. A gate that asked a person to measure something is met in three steps, and then the change ships:

1. **Research.** The published spec (the FTMS and FIT specs), the maker's documentation, independent reviews, and the facts already in [RESEARCH.md](../RESEARCH.md) and in captured frames. A number nobody has published becomes a stated default in docs/SPEC.md, with its source.
2. **A test that pins it.** FTMS conformance on spec and captured frames through the fake GATT, the `SimulatedTrainer` and the pace model for what a rider feels, software WebGL with CPU throttling for the slow tier (`make perf`), objective audio measures (loudness, peaks, WebRTC stats on a local LiveKit loopback), the FIT SDK's own decoder for exported files, and the synthetic fixtures (`testx.Corridor`, the synthetic Alpine fixture) for anything that would have ridden a real route.
3. **Ship it.** Riders' ⚑ flag reports and the feedback queue ([ADR-0006](0006-alpha-feedback-loop.md)) are how real hardware reports back, after release.

So:

- Gears reach every rider (#3333) once the HUD, the keys and the ERG routing are in and P1 to P12 pass as tests. No hardware session.
- The road's Beta marker goes when docs/SPEC.md's road numbers are final from research and simulation (#3351).
- The world budget's slow tier is the throttled software run.
- `needs-human-input` keeps taste, money, legal exposure, risk appetite, roadmap priority, and the operator's own accounts and production systems. A hardware sitting, a rig, a ride or a listening pass is never a reason for it.

## Consequences

- Gears, the road out of beta and the world budget stop waiting on a calendar.
- A trainer quirk that no spec or review mentions reaches riders before we see it. Every trainer write stays inside the clamps that are already tested (MaxTrainerGrade, MinTrainerGrade, the ERG range), so a miss feels wrong but can't push a rider past them. The fix comes from the rider's report.
- [HARDWARE-SESSIONS.md](../HARDWARE-SESSIONS.md) stays as the way anyone with a trainer can report. It is no longer a gate.
- Jan's reference loop never enters an agent's context ([ADR-0063](0063-a-route-keeps-its-place-with-care.md)), so the synthetic fixtures were always the only check an agent could run on it.
