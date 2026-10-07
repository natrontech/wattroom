# Spec: Roads

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Route rides (defaults — tune in alpha; [ADR-0062](../decisions/0062-the-horizon-may-be-a-road.md))

| Parameter                    | Value                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Import                       | a GPX or TCX file of at most **5 MB**, holding a route of **2–200 km**                                                                  |
| Sampling                     | resample every **10 m**; store every **20 m**                                                                                           |
| Elevation                    | a **200 m** rolling median, then a **120 m** moving average                                                                             |
| Stored grade                 | **−15 … +20 %**                                                                                                                         |
| Felt grade                   | difficulty × grade, **× 0.5** again on descents; clamped to **−5 … +15 %**; slewed at most **1 %/s**                                    |
| Difficulty                   | **50 %**; **100 %** under Advanced                                                                                                      |
| Entering a road              | **0 %** for **500 ms** on entering SIM from ERG, then the road |
| Look-ahead                   | the felt grade is read **1 s** ahead of the rider, at the dot's speed                                                                   |
| One gear on a road           | ERG-by-road instead of SIM: FTP × clamp(**0.60** + **0.03** × the road's grade %, **0.50**, **0.90**), and **0.50** on descents steeper than **−2 %**; ± bias |
| Grade written to the trainer | `MinTrainerGrade` **−10 %** (a default until hardware check P11) … `MaxTrainerGrade` **+15 %**, both in `protocol/limits.go`, one range for every trainer |
| Reference rider              | **75 kg** rider + **8 kg** bike at **225 W**                                                                                            |
| Pace model                   | Martin et al. 1998, stepped once a second in **4** substeps (`$lib/road/pace.ts` and its Go twin `internal/road`, held to **0.1 %** by shared golden vectors): Crr **0.004**, ρ **1.225 kg/m³**, drivetrain η **0.97**, CdA **0.32 m²** until the Kickr sessions measure it. The pace model and FTMS share this one CdA; the factor between it and the Cw FTMS is sent (**0.51 kg/m** today, `SIM_DEFAULTS`) is what that session measures, and this row does not assert it |
| Riding on a road             | virtual speed above **0.5 m/s** — presence, auto-pause, auto-end and the recording rule read this                                        |
| Corners                      | a bend of radius r is taken at √(**0.6 g** × r), a 31° lean, and the pace brakes at **4 m/s²** to meet it; there is no brake control     |
| A sample on a road           | its place runs forward from 0 to the route's length, at most **30 m** a second; its height stays within **−500 … 9,000 m** (the .fit's own floor) |
| A road on a workout          | the reader's cut (A route's place), at most **48 KiB** packed                                                                            |
| Leg                          | at most **6 h**                                                                                                                         |

At the default difficulty a −6 % descent feels −1.5 %. A route ride is unscored;
distance and descent pay nothing, and a scored workout on a road pays like any
scored workout (ADR-0062's table).

**Climbs** (the Garmin Edge 1050 manual's rule, fetched 2026-09-26):

- a climb is at least **500 m** long, averages at least **3 %**, and scores
  (length in m × average %) at least **1,500**;
- its class by score: **IV** above 8,000, **III** above 16,000, **II** above
  32,000, **I** above 64,000, **HC** above 80,000 — always in Roman numerals;
- a dip that loses less than **20 m** and is back over the top within
  **300 m** does not end a climb;
- a road keeps its hardest **32** climbs;
- the climb card opens by itself for class **IV** and harder, on a free or
  route ride; on a workout or a session its chip offers it instead ([#3645](https://github.com/natrontech/wattroom/issues/3645)).

## A route's place ([ADR-0063](../decisions/0063-a-route-keeps-its-place-with-care.md))

Privacy rules, not alpha defaults: loosening any of these takes an ADR.

| Parameter                     | Value                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Privacy zone                  | a circle of **200–1,600 m**, about a fixed random offset from the point it hides                |
| Default                       | **400 m** hidden at both ends of every route                                                    |
| km-0 anchor                   | at least **1,000 m** outside every zone                                                         |
| A crew's corridor             | at most **±1,000 m**, stopping at the anchor; tiles withheld within max(anchor distance, **1,000 m**) of the true ends and of any zone |
| An effort near a private end  | within **1,000 m** of the ride's ends: marked at save                                           |
| An effort near a zone         | within **1,000 m** of any zone: hidden at read time                                             |
| A crew member's cached copy   | IndexedDB, expires after **7 days**, capped at **50 MB**                                        |
| Generated name                | `Road · 52.9 km · 1,312 m` — distance and climbing — until the geo pack can name places outside every zone |

## Road segments and ghosts (defaults — tune in alpha; [ADR-0082](../decisions/0082-a-climb-belongs-to-the-map.md))

| Parameter         | Value                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Match             | the matched runs cover every stroke span in order and direction, within **20 m** of the segment's ends, length within **±2 %**   |
| Top half          | only on climbs of at least **2 km**                                                                                              |
| Snapshot          | the same version while the strokes resolve, or the polyline re-matches within a Fréchet distance of **10 m** and **±1 %** length |
| Private distance  | **1,000 m** from the ride's own ends and from every zone (A route's place)                                                       |
| The line          | a point every **10 m** at **0.1 s**; kept for **90 days**, plus the all-time best                                                |
| Ghosts            | at most **3** at once                                                                                                            |
| Visible to others | only efforts that pass `board_ok` (Road times)                                                                                   |
| A board           | only on climbs of at least **5 %** and **3 min** ([ADR-0083](../decisions/0083-the-road-board.md))                                  |
| Board entries     | the top **10** per Category and stretch, over a rolling **90 days**, each rider's best only; opt-in, unnamed ([ADR-0083](../decisions/0083-the-road-board.md)) |
| Board privacy     | no effort whose segment lies within **1,000 m** of its rider's zones or ends, checked when read                                 |
| Board token       | valid **7 days**: an HMAC of the effort id and the ISO week                                                                      |

## Road times ([ADR-0074](../decisions/0074-a-time-is-yours-when-your-watts-moved-your-dot.md) — defaults, tune in alpha)

A road time is the server's replay of the rider's watts on the map's profile,
never the metres a client sent, and an imported file never sets one.

| Rule                          | Value                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Shelter                       | an effort whose mean shelter exceeds **5 %** is untimeable; any tow makes the ride untimeable |
| `board_ok`: account           | at least **14 days** old, with at least **5** saved rides                               |
| `board_ok`: weight            | set at least **7 days** before the ride, and not dropped by more than **2 kg** since     |
| `board_ok`: plausibility      | no more than **110 %** of the rider's own **90-day** best at that duration              |
| `board_ok`: provenance        | recorded by WattRoom and saved fresh; never imported, never Strava-origin               |
| Crew climb times              | this week only, Monday reset, bracketed by Category D–A; fastest and most ascents       |

## Road stats and collections (defaults — tune in alpha; #3123)

What a rider's road riding adds up to. Location-derived stats are the rider's
own (ADR-0063, ADR-0074); a crew gets cooperative sums, such as Everest
together. Nothing here is ranked.

| Parameter          | Value                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Map matching       | ways within **12 m**, covering at least **60 %** of a way's nodes                                     |
| Mark search radius | passes **0 m**, water **60 m**, cafés **80 m**, villages **400 m**, peaks **3 km**                    |
| Climb identity     | a climb is ADR-0082's, matched on stroke spans (Road segments and ghosts, above)                      |
| VAM                | shown only when the average grade is at least **5 %** and the climb takes at least **3 min**          |
| PB highlight       | needs at least **35 m** of gain; at most **3** highlights per ride                                    |
| Col stamp          | passing within **50 m** of the pass node, with at least **50 m** of gain over the last **2 km**       |
| Explorer tiles     | zoom **14**; a straight segment longer than **500 m** ticks nothing                                   |
| Everest            | **8,849 m** (the 2020 survey), everywhere in the app; the ladder **8,849 / 50,000 / 100,000 m**       |
| Everest together   | **8,849** rider-metres per UTC month                                                                  |
| Eddington number   | in road km                                                                                            |
| Overpass           | at most **100** requests and **10 MB** a day                                                          |
| Famous-climbs shelf | about **12**, fixed                                                                                  |
