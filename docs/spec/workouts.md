# Spec: Workouts

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Workout JSON (draft — M1 finalizes)

**HR bands (#67 flavour 1, shipped)**: `steady` steps may carry `hrLow`/`hrHigh`
in raw bpm ("stay under 145" is `{ "hrHigh": 145 }`). Raw bpm on purpose —
these are personal workouts; %LTHR is the upgrade path if shared HR workouts
ever want it. Display-only and **never scored** (ADR-0008: no HR-derived
competition — no execution, no medals, no ranking). Bounds 60–220 bpm.
Closed-loop HR ERG is **HR hold**, below.

**HR hold (#67 flavour 2; defaults — tune in alpha, every number a
proposal with its source)**: a `steady` step with an HR band may set
`"hrHold": true`. The rider's own client then moves the ERG watts to keep heart
rate in the band, inside the one trainer-actuation module (#3049). The hub and
the protocol do not change.

- **Validation**: a hold needs `hrLow` and/or `hrHigh`, and one without either
  is refused. A ceiling alone (`hrHigh`) is a cap: the controller only ever
  lowers the watts from `target`, never raises them past it.
- **Start and window**: it starts at the step's `target`, biased, and never
  leaves **±10 % FTP** around it. That is half of Z2's width (56–75 %, Power
  zones below), so a hold on an endurance step stays in or beside Z2.
- **Interval**: one adjustment every **60 s**. This is the top of #67's 30–60 s
  range, because heart rate lags effort by 30 s to 2 min (#67). It is also three
  time constants of the simulated strap (τ **20 s**,
  `web/src/lib/ble/simulated-sensor.ts`), after which a first-order lag has
  covered 95 % of a step.
- **Step**: at most **2 % FTP** per adjustment. Crossing from the target to the
  window's edge takes five adjustments, five minutes, so one lagging reading
  cannot swing the ride.
- **Smoothing**: heart rate averaged over the last **10 s**. That is half the
  strap model's τ: it adds little lag and removes the beat-to-beat jitter the
  model carries (±1 bpm).
- **Freshness**: a reading older than **3 s** is lost, the dashboard's own
  signal-lost rule (`SIGNAL_LOST_MS`, #37). A reading outside **60–220 bpm**
  (the band's bounds above) is implausible. Either way the controller holds the
  current watts and never raises them, and the dashboard shows it as
  persistent status, never a toast.
- **CI bounds**, on the simulated strap: the hold settles inside the band
  within **10 min** (ten adjustments) of the step starting. After that it
  oscillates by at most **±4 % FTP** (two steps), well inside the ±40 W a
  naive loop swings (#67). The strap gains a power-to-heart-rate response for
  this test; that gain belongs to the test, not to the product.
- **Never scored** (ADR-0008): a hold step carries no weight in execution and
  counts toward no sprint moment, medal or ranking.
- **Alone only**: a session refuses to start a workout that contains a hold
  step, and says why in one line.
- **Easier / Harder** move the bias by ±1 % during a hold, as in any ERG
  workout; the start point and the window move with the biased target
  ([ADR-0084](../decisions/0084-wattroom-shifts.md), #3328).

```jsonc
{ "type": "steady", "seconds": 3600, "target": 0.65, "hrHigh": 145, "hrHold": true }, // a MAF-style cap: never above 145 bpm, never above 65 % FTP
{ "type": "steady", "seconds": 2700, "target": 0.65, "hrLow": 130, "hrHigh": 140, "hrHold": true }, // hold 130–140 bpm, within 55–75 % FTP
```

**Cadence bands (#66, shipped)**: `steady` steps may carry `cadenceLow` and/or
`cadenceHigh` (rpm) — "under 60" is `{ "cadenceHigh": 60 }`, "over 100" is
`{ "cadenceLow": 100 }`. Display-only: the player shows the band next to the
power target, coloured in/out of band; the execution score stays power-based.
Bounds 30–150 rpm; a `cadenceLow` at or under the spiral guard's 50 rpm trip
is refused at validation — a workout must not fight a safety feature.

```jsonc
{
  "name": "2x20 Sweet Spot",
  "author": "wattroom",
  "steps": [
    { "type": "warmup", "seconds": 600, "from": 0.4, "to": 0.7 }, // ramp, fractions of FTP
    { "type": "steady", "seconds": 1200, "target": 0.9 },
    {
      "type": "steady",
      "seconds": 360,
      "target": 0.85,
      "cadenceLow": 55,
      "cadenceHigh": 65,
    }, // torque block
    { "type": "steady", "seconds": 300, "target": 0.5 },
    {
      "type": "repeat",
      "times": 4,
      "steps": [
        { "type": "steady", "seconds": 30, "target": 1.2 },
        { "type": "steady", "seconds": 90, "target": 0.55 },
      ],
    },
    { "type": "cooldown", "seconds": 300, "from": 0.6, "to": 0.35 },
    { "type": "sprint", "seconds": 15 }, // armed sprint moment marker
  ],
}
```

Targets are fractions of FTP; absolute watts allowed via `"watts": 250` instead of `target`. A `road` step rides a stretch of road in SIM at its felt grade ([ADR-0062](../decisions/0062-the-horizon-may-be-a-road.md)); it is what a `freeride` step type was once promised as, and there is no `freeride` type. A `ramp` step (`from`/`to`, the editor's) is a mid-workout ramp between two fractions — the same shape as `warmup`/`cooldown`, interpolated per second and unscored like them (#1709). All three interpolate the same way: the block's first second is `from` and its last is one step short of `to`, because `to` is where the next block starts — a ramp is still ramping on its final second (#1394).

`repeat` steps nest: a set of sets expresses over-unders without writing every rep out. The engine has always flattened recursively; the type used to forbid it (#12).

A **road workout** carries its road by reference at the top level, and nothing
else: `"road": { "routeId": "…", "fromM": 0, "toM": 42000, "stepEndM": [ … ] }`
names the stored route, the stretch it rides (forward, within the route's
**200 km**), and where each block ends, in order along that stretch. A road
that carries heights or a shape is refused, because a copy could not be erased
with the route (#3051). Every read attaches the reader's cut of the road (A
route's place). A `road` step may set `fromM`, where on the road it starts;
absent is where the last one left off. It has no target and is unscored.

A workout may also carry top-level `"unscored": true`, which says its execution score is meaningless and stores the ride with `execution_scored = false` — no percentage on the ride, no `execution% × 50` XP bonus. Absent is scored. The **ramp test is the only workout that sets it**, and the editor never offers it: it is a property of a workout that measures the rider, not a setting (#1400).
