# Product Spec — the numbers and flows behind WATTROOM.md

[WATTROOM.md](../WATTROOM.md) says *what* and *why*; this file pins the concrete values and flows so implementations match intent. Values marked **(default — tune in alpha)** are starting points, changeable without an ADR; everything else changes only via ADR.

## Glossary

| Term | Meaning |
|---|---|
| **Room** | Persistent named space with members and roles. Sessions happen *in* rooms. |
| **Session** | One group ride in a room: a workout (or game mode) + a shared timeline. |
| **Coach** | The role driving the shared timeline of a session (pick workout, start countdown, arm sprints). The owner is coach by default and can hand it off. |
| **Tick** | The 1 Hz server broadcast coalescing every rider's latest sample. 4 Hz during sprint windows. |
| **Sample** | One rider datapoint: watts, HR, cadence, seq. Client → server at ~1 Hz. |
| **Execution score** | How precisely you rode your prescribed targets (see formula below). |
| **Level** | XP-based, only goes up, earned by work done. |
| **Category** | Fitness tier D–A from your 90-day w/kg power curve. Moves both directions. |
| **Sprint moment** | Coach- or workout-armed 15 s all-out window; trainer flips ERG→slope. |
| **Spiral guard** | ERG low-cadence protection: detect collapse, temporarily release target. |
| **WCPS** | Wahoo's proprietary BLE control protocol (Kickr v2 path). |

## Roles & permissions

| Capability | Owner | Coach | Member | Spectator (phone) |
|---|---|---|---|---|
| Edit room (name, listing, sound pack) | ✓ | – | – | – |
| Assign/remove coach role | ✓ | – | – | – |
| Pick workout / mode, start countdown, pause/end session | ✓ | ✓ | – | – |
| Arm sprint moments | ✓ | ✓ | – | – |
| Add to jukebox queue | ✓ | ✓ | ✓ | – |
| Jukebox play/pause/skip | ✓ | ✓ | ✓ (default — tune in alpha) | – |
| Ride (metrics on dashboard) | ✓ | ✓ | ✓ | – |
| Voice/camera | ✓ | ✓ | ✓ | – |
| Emoji cheers | ✓ | ✓ | ✓ | ✓ |

Session lifecycle: room idles (voice/jukebox lounge) → coach picks workout → 10 s countdown **(default)** → shared timeline runs → riders execute their own %FTP targets → session closes when the timeline ends (or coach ends it) → server computes stats + medals in one transaction. Late joiners sync to the current timeline position. A member stopping mid-session pauses *their own* targets (auto-pause) — the shared timeline never waits.

## Workout JSON (draft — M1 finalizes)

Planned, additive, not yet in the format: optional per-step `cadence` targets (#66) and HR bands (#67) — steps without them behave exactly as today.

```jsonc
{
  "name": "2x20 Sweet Spot",
  "author": "wattroom",
  "steps": [
    { "type": "warmup",   "seconds": 600, "from": 0.4, "to": 0.7 },          // ramp, fractions of FTP
    { "type": "steady",   "seconds": 1200, "target": 0.9 },
    { "type": "steady",   "seconds": 300,  "target": 0.5 },
    { "type": "repeat",   "times": 4, "steps": [
      { "type": "steady", "seconds": 30, "target": 1.2 },
      { "type": "steady", "seconds": 90, "target": 0.55 }
    ]},
    { "type": "cooldown", "seconds": 300, "from": 0.6, "to": 0.35 },
    { "type": "sprint",   "seconds": 15 }                                     // armed sprint moment marker
  ]
}
```

Targets are fractions of FTP; absolute watts allowed via `"watts": 250` instead of `target`. `freeride` step type for slope-mode segments comes with game modes.

`repeat` steps nest: a set of sets expresses over-unders without writing every rep out. The engine has always flattened recursively; the type used to forbid it (#12).

## Power zones (Coggan 7-zone, % of FTP)

Used by Floor is Lava's called zones, time-in-zone scoring, and the interval-graph colour ramp.
Token names are the styleguide's (`--color-z1`…`z7`) — see `/dev/styleguide`.

| Zone | Name              | % FTP     |
| ---- | ----------------- | --------- |
| Z1   | Active recovery   | ≤ 55 %    |
| Z2   | Endurance         | 56–75 %   |
| Z3   | Tempo             | 76–90 %   |
| Z4   | Threshold         | 91–105 %  |
| Z5   | VO₂ max           | 106–120 % |
| Z6   | Anaerobic         | 121–150 % |
| Z7   | Neuromuscular     | > 150 %   |

## Stats formulas (defaults — tune in alpha)

- **Tolerance band**: within ±5 % of target power, floor ±10 W (beginners at 100 W targets need the floor).
- **Execution score** (per ride): `% of riding seconds inside the band`, weighted by step intensity (each second weighs `target/FTP`, so nailing VO2 intervals counts more than nailing recovery). Warmup/cooldown/freeride excluded. Auto-paused time excluded.
- **XP**: `1 kJ = 1 XP`, plus per-ride bonus `execution% × 50`, plus streak bonus `25 × current-week-streak` (capped at 250). Level thresholds: level n requires `500 × n^1.6` cumulative XP (a winter of 3 rides/week ≈ level 25–30).
- **Category** from best 20-min w/kg over rolling 90 days: **D < 2.5, C 2.5–3.2, B 3.2–4.0, A ≥ 4.0**. Recompute on ride completion; category changes announce in the room (up: fanfare; down: silently).
- **Power curve**: best-effort 5 s / 1 min / 5 min / 20 min per ride, merged into the 90-day rolling curve.
- **FTP suggestions**: when 90-day `0.95 × best-20-min` exceeds set FTP by >2 %, prompt (never auto-apply).
- **Ramp test**: 5-min warmup (35 → 50 % FTP), then target starts at 100 W **(default)**, +20 W/min for up to 25 steps; FTP = 75 % of **best rolling 60 s** (rolling, not per-step — riders fail mid-step and their best minute straddles the boundary).
  - **Blown** = power below 75 % of target for 5 consecutive seconds. The test ends itself; a rider at the end of a ramp will not press a button.
  - **Too short to score**: fewer than warmup + 2 completed steps produces no FTP at all. FTP scales every workout, so a number derived from a warmup is worse than no number.

## Ride guards

Numbers moved here from code after being ridden (#46). The cadence path was validated on a
Kickr Core on 2026-08-29: deliberate grind tripped the guard at 37 rpm under a held target,
the target released for 9.6 s (one tick under the 10 s window), and re-engaged at 158 W
once cadence recovered to 82 rpm. No false trips across any prior hardware session.

**Auto-pause** — the rider stopped, so their targets stop (clock does not rewind):

| Parameter | Value |
| --- | --- |
| Stopped = cadence below | 5 rpm |
| …AND power below | 20 W (cadence alone unsafe — some trainers report none) |
| Pause after | 3 s stopped |
| Resume countdown | 3 s (resuming must not be a jump-scare) |

**Spiral-of-death guard** — ERG piles on resistance as cadence dies; the guard breaks the loop:

| Parameter | Value |
| --- | --- |
| Trip: cadence below | 50 rpm while an ERG target is held |
| …for | 5 consecutive seconds |
| Fallback (no cadence source) | power below 50 % of target, same 5 s |
| Release duration | 10 s of no target, then re-engage automatically |

The power-collapse fallback is unit-tested but has never run on hardware: every trainer on
the team reports cadence (ADR-0007), so the cadence branch always wins. It stays for any
future trainer that reports none.

## Medals (per group session)

- **Diesel** — lowest power variability (coefficient of variation) across steady steps
- **Metronome** — best execution score
- **Hammer** — best 5 s w/kg
- **Lanterne Rouge** — last on the final sprint/podium metric but completed the session
- Ties: earlier joiner wins. Minimum 3 riders for medals (default — tune in alpha).

## Game mode parameters (defaults — tune in alpha)

| Mode | Parameters |
|---|---|
| Backyard Ramp | 3-min rounds, start 80 % FTP, +5 % FTP/round; eliminated after 10 s continuously below band; eliminated riders get 50 % FTP ERG and stay in room |
| Floor is Lava | Called zone (Coggan 7-zone); leaving the zone >5 s burns a life; 3 lives; zone changes every 2 min |
| Watt Golf | 9 or 18 holes; "hit X W for 10 s, starting in 20 s"; meter hidden from 20 s before to hole end; strokes = mean absolute deviation in watts; targets 60–110 % FTP |
| Sprint Roulette | 10–15 s sprints, random gap 3–8 min, klaxon 3 s before; scored on best 5 s w/kg |
| Points Race | Sprints 5 pts/3/2/1; best interval-execution 3 pts; time-in-zone streak 1 pt/interval |
| Team Relay | One rider "on front" at 110 % FTP (others 55 %); rotate on 60–90 s timer or call-out; room distance = Σ front-seconds × front-watts |
| Collective Ramp | Backyard rules on the **room-average** %FTP; line starts 75 %, +4 %/round; score = rounds survived |

Elimination modes: 30 s disconnect grace (IndexedDB buffer proves continued pedalling on reconnect).

## Sync tolerances

- Metrics latency budget: pedal → every screen **< 500 ms**.
- Jukebox drift (revised per RESEARCH.md §10): **seek-first design** — hard `seekTo(t, allowSeekAhead=true)` when drift > 1.5 s **(default — tune in alpha)**, then **re-measure** (unbuffered seeks land on an earlier keyframe). Rate-nudging is an *optional* enhancement: YouTube rounds unsupported rates toward 1 and only `onPlaybackRateChange` confirms a change, so nudge only at rates listed by `getAvailablePlaybackRates()`, else skip the tier entirely. Between corrections, dead-reckon position locally every 250 ms (OpenTogetherTube's proven design).
- Shared timeline: server-authoritative; clients render from tick timestamps, never local clocks.

## Room audio defaults (defaults — tune in alpha; rationale RESEARCH.md §12)

- Mic default: **voice-activity gating** (browser noiseSuppression + echoCancellation on). While the jukebox plays: tightened VAD threshold + a one-tap push-to-talk toggle offered in the dashboard.
- Joining a room with music playing and mic open → one-line **headphone nudge** (dismissible, never blocking). Echo cancellation is treated as best-effort — the defaults must work without it.
- Jukebox audio is always local per rider (own iframe, own volume) and never enters the voice path.
- Ride-critical timers (ERG targets, tick handling) run in a **Web Worker** with Wake Lock held — main-thread timers throttle in hidden tabs (an active call exempts the tab, solo rides are not exempt).
