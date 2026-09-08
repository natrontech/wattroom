# Audit — the riding path — 2026-09-08

Run against main @ `6b9d5ce3` (after #1135). Read-only: nothing was changed, and nothing was
verified in a running app.

**Produced one issue, [#1143](https://github.com/natrontech/wattroom/issues/1143).** The rest of
this document is the *solid* half — what was checked and found to hold — which is the part that
stops the next audit re-deriving the same conclusions.

## The brief

Slice: **the riding path** — workout execution and scoring, stats, medals, ride recording,
training load and progression, the ramp test, the ride guards, and the .fit export.

Chosen because it is the one slice with a **named** gap. The [2026-09-04
audit](2026-09-04-non-riding.md) was explicitly *"the whole website, but excluding the actual
riding features (this will be another pass — specialized)"*, and that pass had never happened. The
[hub/protocol audit](2026-09-08-hub-protocol.md) covered the tick loop, the game modes and the WS
contract, and said it read `internal/gamify` and `internal/recap` only where the tick hands off to
them.

Excluded, because they have just been swept or belong to somebody else: `internal/hub` and
`internal/protocol` internals, the rooms/membership/crew surface (swept the same day — it produced
[#1113](https://github.com/natrontech/wattroom/issues/1113)), the jukebox, AV, the desktop shell
and the theme.

Single-threaded rather than fanned out, per the skill's "sized to the plan the maintainer is on".

## The finding

**[#1143](https://github.com/natrontech/wattroom/issues/1143)** — `stats.Execution` returns `1.0`,
a perfect score, when *nothing could be scored*. That value is stored on the ride, paid as the
`execution% × 50` XP bonus, and used to award the **Metronome** medal — which 1.0 wins over every
rider who actually rode the intervals. The same rider also takes **Lanterne Rouge**, because
`Best5sWkg` is 0 and that medal goes to the lowest.

Reachable: nothing filters a zero-watt sample on the way in (`live.svelte.ts:340` sends
unconditionally, `accumulator.go:77` keeps any sample, and `saver.go:88` guards only on a sample
*count*), so a trainer that drops out for the main set produces it.

## What was checked, and found sound

| Claim | Source | Verdict |
| --- | --- | --- |
| Tolerance band ±5 %, floor ±10 W | SPEC stats formulas | `engine.go:36` — `math.Max(target*0.05, 10)` |
| Execution weighted `target/FTP`, warmup/cooldown/freeride and unpowered seconds excluded | SPEC | `engine.go` — matches, and uses the rider's biased target so live and saved agree (#795) |
| XP `1 kJ = 1 XP` + `execution × 50` | SPEC | `engine.go:84` |
| Streak bonus `25 × weeks`, capped 250 | SPEC | `streak.go:37` |
| Level `500 × n^1.6` | SPEC | `web/src/lib/level.ts` |
| Category D < 2.5, C 2.5–3.2, B 3.2–4.0, A ≥ 4.0 | SPEC | `engine.go:87-98` |
| FTP suggestion at `0.95 × best-20-min` exceeding FTP by > 2 % | SPEC | `engine.go:105-110` |
| Ramp: 100 W start, +20 W/min, 25 steps, 5-min warmup 35→50 %, FTP = 75 % of best rolling 60 s | SPEC | `web/src/lib/workout/ramp.ts` — every number, and the file says not to tune them in code |
| Ramp blown = below 75 % of target for 5 s; unusable below warmup + 2 steps | SPEC | `ramp.ts` — `failFraction`, `failSeconds`, `rampUsable` |
| LTHR suggestion `0.90 × max test HR`, only from a **scoreable** ramp, never auto-applied | SPEC, ADR-0014 | `routes/ramp/+page.svelte` — the whole result panel including the LTHR block sits inside the `usable` branch |
| Auto-pause: cadence < 5 rpm AND power < 20 W, 3 s to pause, 3 s resume | SPEC ride guards | `web/src/lib/workout/guards.ts` |
| Spiral guard: cadence < 50 rpm for 5 s, power fallback at 50 % of target, 10 s release | SPEC ride guards | `guards.ts` |
| Power zones (7, Coggan) and HR zones (5, % LTHR) | SPEC, ADR-0014 | `web/src/lib/components/zones.ts` — tops `[0.55, 0.75, 0.9, 1.05, 1.2, 1.5]`, HR edges `[0.68, 0.83, 0.94, 1.05]` |
| NormPower: 30 s rolling, 4th power, plain average below 20 min | SPEC, ADR-0016 | `load.go` |
| Fitness/Fatigue 42/7-day EWMAs; Form as a percentage of Fitness | SPEC | `load.go:77-78` |
| The five form zones, and the five "suggested for today" rules **in order** with their why-clauses | SPEC | `load.go:92-131` — every threshold and every string |
| 28-day cold start hides form status and nudges | SPEC | `progression.go:83,109` gates the suggestion, and **both** consumers honour `building` — `home/+page.svelte:56` and `history/+page.svelte:303` |
| Medals: four kinds, minimum 3 riders, ties to the earlier joiner | SPEC | `medals.go` — `minRidersForMedals = 3`, stable sort by `JoinOrder` |
| Heart rate in the .fit export | ADR-0008 | Correct: the export is the rider's **own** durable ride, which the ADR explicitly keeps. The rule it must not break is *cross-rider* artifacts |

The recurring reason this half holds: the constants are not scattered. `ramp.ts`, `guards.ts` and
`zones.ts` each carry a header saying the numbers are `docs/SPEC.md`'s and must not be tuned in
code, and each one is the only place its numbers appear.

## What was not covered

The BLE/trainer layer beyond reading how samples reach the hub — `web/src/lib/ble/` (FTMS, the
arbitrator, revolution maths) deserves its own pass with hardware, and
[docs/HARDWARE-SESSIONS.md](../HARDWARE-SESSIONS.md) is how to do it. Nothing was ridden, so this
says nothing about behaviour against a real trainer; the ride-guard numbers were validated on a
Kickr Core on 2026-08-29 per SPEC, and the power-collapse fallback still has not run on hardware.
The Strava upload path and `internal/recap` were not read.
