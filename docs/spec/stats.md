# Spec: Zones, stats, XP and load

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Power zones (Coggan 7-zone, % of FTP)

Used by Floor is Lava's called zones, time-in-zone scoring, and the interval-graph colour ramp.
Token names are the styleguide's (`--color-z1`…`z7`) — see `/dev/styleguide`.

| Zone | Name            | % FTP     |
| ---- | --------------- | --------- |
| Z1   | Active recovery | ≤ 55 %    |
| Z2   | Endurance       | 56–75 %   |
| Z3   | Tempo           | 76–90 %   |
| Z4   | Threshold       | 91–105 %  |
| Z5   | VO₂ max         | 106–120 % |
| Z6   | Anaerobic       | 121–150 % |
| Z7   | Neuromuscular   | > 150 %   |

## Heart-rate zones (Coggan 5-zone, % of LTHR — ADR-0014)

Anchored on the rider's **LTHR** (profile, bpm, bounds 100–210). Display-only:
colours the rider's **own** bpm readout, never anyone else's, never scored
(ADR-0008). Z6/Z7 have no HR analog — heart rate lags too hard for them.

| Zone | Name            | % LTHR   |
| ---- | --------------- | -------- |
| Z1   | Active recovery | ≤ 68 %   |
| Z2   | Endurance       | 69–83 %  |
| Z3   | Tempo           | 84–94 %  |
| Z4   | Threshold       | 95–105 % |
| Z5   | VO₂ max         | > 105 %  |

- **LTHR suggestion from a ramp test**: a scoreable ramp test with HR recorded suggests
  `0.90 × max test HR` **(default — tune in alpha)** — a rough estimate: LT2 sits at 85–92 % of
  HRmax and a ramp's peak need not be HRmax (RESEARCH §17.2; Friel's 30-min field test is the
  real measurement) — one tap to apply, never
  auto-applied (same posture as FTP suggestions). The result panel says it is rough.
- **LTHR suggestion from a hard ride** (#1620): a **solo** ride of **at least 30 minutes**
  carrying heart rate, whose **average HR over its last 20 minutes** exceeds the rider's set
  LTHR by **more than 2 %**, prompts with that average — one tap to apply, **never
  auto-applied**. Scoped to the same rolling **90 days** as the FTP rule below, and the largest
  such average in the window is the one offered. The measurement is Joe Friel's 30-minute time
  trial (RESEARCH §17.2): ride 30 minutes alone as hard as is sustainable, and the last 20
  minutes' average heart rate is LTHR.
  - **Solo** is a ride outside any session — the protocol wants nobody to pace off.
  - **There is no power gate.** The qualification is duration and the HR gap alone: a rider
    doing a genuine HR field test need not be near their best 20-minute power, so gating on
    power would silently skip the very protocol this implements. The cost is prompts after
    hard rides that were not tests — accepted, because a prompt is one tap to dismiss and
    never applies itself. **The prompt therefore says out loud that it assumes the ride was
    all-out**; that sentence is what a power gate would otherwise have done.
  - Seconds in the window with no reading are not averaged — a dropped strap second is
    absent, never a zero — but **at least half the window has to carry a reading**, or the
    ride has no number at all. Without that floor one second IS the average: a strap that
    re-acquires in the last minute with a single spurious beat would offer it as a threshold.
  - A rider with **no LTHR set** is not prompted: there is nothing for the average to exceed.
    The ramp test above is where a first LTHR comes from.

## The rider's two numbers (ADR-0048)

FTP and weight are what everything else here is relative to: every workout target is a
fraction of FTP, and so are the execution score, the XP bonus, the category, the training
load and every later FTP suggestion; weight is the denominator of every w/kg the app prints.
Bounds, enforced identically by the schema CHECKs, the profile PATCH and the web store
(`PROFILE_LIMITS`): **FTP 50–600 W**, **weight 30–200 kg**, **LTHR 100–210 bpm**.

- **Where they come from** is recorded per number as `default` (nobody chose it — the account
  was created with the app's opening 200 W / 75 kg), `manual` (the rider set it, by typing it
  or accepting a suggestion) or `ramp` (a ramp test measured it). Rejected, never coerced: a
  typed 900 is a refusal naming the field, not a silent 200.
- **A new account is asked, and never gated.** The first-run card's first step asks for both,
  prefilled with 200 W and 75 kg — keeping them is a valid answer and records `manual`. A
  rider who skips it rides anyway.
- **An unchosen number never reads as a measured one.** While the source is `default`, Home's
  FTP tile says it is a starting guess, and w/kg is withheld until at least one of the pair is
  the rider's own — two guesses divided by each other is a fiction with a decimal point.

## Stats formulas (defaults — tune in alpha)

- **The day boundary is the rider's own** (#2063). Every per-rider calendar
  bucket — the daily Load below, the **rider streak**'s week, the clock
  achievements, the rider page's month — starts the day where the rider is,
  from `users.timezone` as the browser reported it (#858). The column is
  nullable and a rider who has never told us buckets at **UTC**. This was
  written down because four of those surfaces once disagreed: a ride finished
  at 21:00 CET was on today in one place and tomorrow in three others, and a
  Monday-00:30 ride in Zurich was filed into the week before, halving a streak
  bonus the rider had earned. Neither answer was wrong; showing a rider both
  was. One helper decides it for the SQL and the Go alike
  (`server/internal/stats/zone.go`), because a query bucketing in one zone
  while Go re-buckets in another is the same bug one level down.
  - **Crew buckets are UTC**, and that is a different question, not an
    oversight: a crew's riders sit in several zones and a crew has no zone of
    its own. The **crew streak**, its month, its session days and its weekly
    board are all UTC, and the copy never calls them a rider's days.
  - **The lounge XP cap stays a UTC day** (below). It is applied inside the
    insert as blocks land, so it is a rate limit on a live meter rather than a
    number a rider reads back against their calendar.
- **Tolerance band**: within ±5 % of target power, floor ±10 W (beginners at 100 W targets need the floor). The target is the rider's **own**: the prescribed fraction × their bias (0.8–1.2, set during the ride, #795), so the band follows the plan they were actually on; the weight below stays the prescribed intensity.
- **Execution score** (per ride): `% of riding seconds inside the band`, weighted by step intensity (each second weighs `target/FTP`, so nailing VO2 intervals counts more than nailing recovery). Warmup, cooldown and road steps excluded. Auto-paused time excluded. Because the band is biased, execution is not like-for-like between riders — one at 0.8 rides 20 % easier and can still score 1.0; Metronome and the execution bonus reward riding the plan you set, not the hardest plan.
- **XP**: `1 kJ = 1 XP`, plus per-ride bonus `execution% × 50`, plus streak bonus `25 × current-week-streak` (capped at 250) — the **rider streak**, their own weeks wherever they rode, never the crew streak its Home displays (Glossary). Level thresholds: level n requires `500 × n^1.6` cumulative XP (a winter of 3 rides/week ≈ level 25–30).
- **Category** from best 20-min w/kg over rolling 90 days: **D < 2.5, C 2.5–3.2, B 3.2–4.0, A ≥ 4.0**. Recompute on ride completion; category changes announce in the session (up: fanfare; down: silently).
- **Power curve**: best-effort 5 s / 1 min / 5 min / 20 min per ride, merged into the 90-day rolling curve. 3 and 12 min are kept too, per ride and in the 90-day curve, for the critical-power model (CP and W′ from the standard two-point pair, [#3261](https://github.com/natrontech/wattroom/issues/3261)), and are never shown as PRs or rank currencies.
- **FTP suggestions**: when 90-day `0.95 × best-20-min` exceeds set FTP by >2 %, prompt (never auto-apply).
- **FTP history** (the trend chart, #222/#1572): the line is the FTP each ride was **scored against**, captured on the ride row — a record, never a reconstruction. A ramp test additionally records the FTP it **produced** on its own ride, set only once the rider accepts the number, and that is drawn as its own mark rather than bending the line; without it a test's result would not appear until the rider's next ride. Fewer than two rides is not a trend and draws the empty state instead.
- **Ramp test**: 5-min warmup (35 → 50 % FTP), then target starts at 100 W **(default)**, +20 W/min for up to 25 steps; FTP = 75 % of **best rolling 60 s** (rolling, not per-step — riders fail mid-step and their best minute straddles the boundary). The 75 % is Ric Stern's MAP→FTP midpoint of a 72–77 % band, ±5 % for most riders and worse at the extremes (RESEARCH §17.1).
  - **Blown** = power below 75 % of target for 5 consecutive seconds. The test ends itself; a rider at the end of a ramp will not press a button.
  - **Too short to score**: fewer than warmup + 2 completed steps produces no FTP at all. FTP scales every workout, so a number derived from a warmup is worse than no number.
  - **Saved as a ride, unscored** (#1400): a finished ramp lands on the history like any other ride — kJ, XP, power curve, FIT and Strava export — and carries `"unscored": true`, so no execution score is stored, shown or paid. The steps are ERG targets the trainer holds the rider on, so a score there measures the trainer; a ramp is still the hardest ride most riders do in a month and discarding it was read as data loss.

## XP sources (defaults — tune in alpha)

Riding earns XP as above. Everything else a rider earns lives in the `xp_events`
ledger (#467), and `user_total_xp` = rides + ledger is the one lifetime number
every level derives from. **Fairness rule**: no non-riding source out-earns a
typical ride — 45 min ≈ 600 kJ ≈ 650 XP — so the lounge caps at 24 a day, a
session bonus is 5, and achievements pay once.

| Source                  | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Riding**              | `1 kJ = 1 XP` + execution bonus + streak bonus (Stats formulas above). A ride the browser **uploads** — solo, free or recovered, `POST /api/rides` — is the client's word, so it is bounded ([#3044](https://github.com/natrontech/wattroom/issues/3044)): it is refused when it shares a second with a ride already on the account (nobody rides two at once), and uploaded rides pay at most **6,000 XP per rider per UTC save day** (about 6 h at 280 W). A ride past the ceiling is saved with what is left of it, down to 0, and says so in its XP. One that started earlier than the week before its save is kept, and counts toward no **rider streak** (Glossary) — whose bonus session rides pay outside the ceiling. Deleting a ride does not return its share of the day — otherwise delete-and-repost mints without end, since the deleted ride's XP stays (below). A session ride, saved by the hub from seconds it watched arrive, is outside the ceiling. |
| **Lounge presence**     | **1 XP per 5 full minutes in voice** — in any voice channel's call — capped at **24 XP per rider per UTC day**. Leaving resets the five-minute count. Presence is what LiveKit's join/leave webhooks say — the server cannot hear who talks (mute state is client-reported), so "talking" is measured as being on the call, and every surface says "in voice", never "talking". Blocks past the cap are recorded at 0 XP so lounge hours keep counting toward Lounge Lizard. |
| **Session voice bonus** | **5 XP per group session** the rider was in voice for **at least half of** the running timeline (pauses excluded). A group session has **≥ 2 saved rides** and **≥ 10 min** of timeline. Riders and listeners alike — a coach without a trainer on the call earns it.                                                                                                                                                                         |
| **Achievements**        | One-time **100 (easy) / 250 (medium) / 500 (hard)** XP, paid the day the shelf gets the trophy.                                                                                                                                                                                                                                                                                                                                               |
| **Deleted rides**       | An offsetting row when a rider deletes a ride: **amount = that ride's XP**, `ref` = the ride's id. The delete is hard, so the ride leaves `sum(rides.xp)` and this puts the same number back — `user_total_xp` does not move. Never new XP and never a measure a badge is judged from: deleting a ride is privacy, not work ([ADR-0047](../decisions/0047-deleting-a-ride-keeps-its-xp.md)).                                                     |

### Achievements

Only what the server can verify on its own is in the catalogue
(`server/internal/gamify/catalogue.go`; the client's copy is held to it by a
test). Clock times use the **rider's own zone** — the day boundary above,
falling back to UTC for a rider who has never reported one — and say so:
getting up at 07:30 is not an early ride wherever the rider lives, and the
server's zone made Sunrise Club a fact about the server (#2063). Ride achievements are judged per ride at save time from the samples
in hand — rides store no zone seconds — so they show no partial progress.

| Key                   | Name                | Earned by                                                                                               | Tier   |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| `sunrise-club`        | Sunrise Club        | 5 rides started before 07:00                                                                            | easy   |
| `night-shift`         | Night Shift         | 5 rides ended after 23:00 (a ride that runs past midnight counts)                                       | easy   |
| `200-rides`           | 200 Rides           | 200 rides                                                                                               | hard   |
| `sufferfest-survivor` | Sufferfest Survivor | ≥ 45 min at or above FTP in one ride                                                                    | hard   |
| `hot-end`             | Hot End             | ≥ 3 min in Z6 or above (≥ 121 % FTP) in one ride                                                        | medium |
| `espresso-ride`       | Espresso Ride       | a ride under 25 min with ≥ 80 % of its seconds above sweet spot (> 94 % FTP; sweet spot is 88–94 %)     | medium |
| `lounge-lizard`       | Lounge Lizard       | 10 h of voice presence (120 five-minute blocks)                                                         | medium |
| `dj`                  | DJ                  | 50 queued tracks a voice channel played to the end — a skip does not count. "Played" is the server's own clock ([#2931](https://github.com/natrontech/wattroom/issues/2931)): at least **60 s** of play, pauses left out, and a library track whose length is known must also reach **its length − 5 s** **(defaults — tune in alpha)**. The client's "ended" moves the deck on and earns nothing by itself | medium |
| `crew-chief`          | Crew Chief          | pressed start on 20 sessions with ≥ 3 saved rides (the medal minimum)                                   | hard   |
| `sprint-snob`         | Sprint Snob         | first on the w/kg podium of 10 sprint moments with **≥ 2** riders scored — a podium of one is not a win | medium |

Not in the catalogue, because the server cannot verify them: **The Quiet
Type** (10 sessions in voice without unmuting — mute is client-reported) and
**Never Gonna Give You Up** (riding through a track queued "as a joke" — a joke
is not a fact the server holds). Client-reported claims never earn trophies.

Visibility: `/api/me/trophies` is yours; `/api/riders/{id}/trophies` shows a
rider's case to the people who could already watch them ride — riders who share
a channel with them, and friends — and is a 404 to everyone else.

## Training load (defaults — tune in alpha; model rationale ADR-0016, research RESEARCH.md §13)

Naming is deliberate: TSS/NP/IF/CTL/ATL/TSB are Peaksware trademarks — WattRoom ships the
published math under the names **Load, Intensity, Fitness, Fatigue, Form** (the
intervals.icu convention). Everything below is per-rider, computed from WattRoom rides
only, and every surface says so ("based on your WattRoom rides").

- **NormPower** (per ride): 30 s rolling average of 1 Hz power → each value to the 4th
  power → mean → 4th root. Rides shorter than 20 min use plain average power instead
  (the rolling-4th-power estimate is not meaningful below that; TrainingPeaks convention).
  Stored on the ride at save time; missing values are backfilled once from the sample blob.
- **Intensity** = `NormPower / FTP-at-ride-time`.
- **Load** = `Intensity² × hours × 100` — one hour exactly at FTP = 100 by construction.
  Derived from stored columns on read, never stored itself.
- **Daily Load** = sum of that day's rides — the rider's own day (Stats formulas, #2063); a day without rides counts 0.
- **Fitness** = 42-day exponentially-weighted average of daily Load
  (`F_d = F_d−1 + (Load_d − F_d−1)/42`). **Fatigue** = the same with 7
  (`/7`). **Form** = yesterday's Fitness − yesterday's Fatigue, displayed as a
  **percentage of Fitness** (absolute bands assume a ~100 Load/day athlete; ours aren't).
- **Form zones** (Friel-derived, via intervals.icu's percentage form):
  **> +20 %** transition · **+5…+20 %** fresh · **−10…+5 %** grey ·
  **−30…−10 %** optimal (building) · **< −30 %** high risk.
- **Cold start**: form status and every load-derived nudge stay hidden until **28 days**
  after the rider's first saved ride — a 42-day average over a week of data reads as a
  dangerous ramp for every new rider. Charts may render sooner with a "building history"
  note.
- **Tone rule** (not a number, still binding): zone words describe the day, never grade
  the rider — no "unproductive", no "failed". Load-derived suggestions are hints with a
  one-clause why and never gate picking any workout.

**Suggested for today** (one suggestion, first matching rule wins; nothing before the
28-day cold start; thresholds from RESEARCH.md §13.3, worded per the tone rule):

| #   | Rule                                      | Suggests      | Why-clause                      |
| --- | ----------------------------------------- | ------------- | ------------------------------- |
| 1   | form < −30 %                              | recover       | "carrying serious load"         |
| 2   | no ride in ≥ 14 days                      | restart       | "first ride back after a break" |
| 3   | yesterday's Load > 1.5 × median ride Load | endurance     | "yesterday was big"             |
| 4   | Fitness rose > 8 in the last 7 days       | endurance     | "load is climbing fast"         |
| 5   | form ≥ +5 %                               | intensity     | "you're fresh"                  |
| —   | otherwise                                 | no suggestion |                                 |

Suggestion → workout focus: **recover** = Recovery · **restart** = Recovery, Endurance ·
**endurance** = Endurance · **intensity** = Sweet spot, Threshold, VO₂ max. The badge
marks matching workouts in the picker; every workout stays rideable.

## How a ride felt (#2328)

Two rides with identical average watts can feel nothing alike, and the trainer
records neither difference. A finished ride may therefore carry two optional
things the rider says about it: one number and one sentence. Both are entered
after the ride, never during it — this is the one moment `.claude/rules/ux.md`'s
no-typing rule does not apply, because the rider is off the bike.

- **RPE is the Borg CR10 session scale, integers 1–10**, one number for the
  whole ride — the category-ratio scale published by Borg, in the session-RPE
  form Foster (2001) put it to. Published anchors, used verbatim: **1** very easy · **2** easy · **3** moderate · **4** somewhat hard ·
  **5** hard · **7** very hard · **10** maximal. **6, 8 and 9 carry no word** —
  that is the scale's own design, steps between the anchors either side of them,
  and inventing labels for them would not be the CR10 any more.
- **0 is not offered.** CR10's zero is "rest"; a saved ride is at least a minute
  of pedalling, so the lowest a ride can be is 1.
- **The note is free text, 1–500 characters** — the same bound a chat message
  has, and for the same reason: it is a sentence, not a journal entry. An empty
  note is no note, and clearing it removes it.
- **Both are optional, both are erasable, and neither is ever asked for twice.**
  Nothing in the app is gated on them, no streak counts them, and a ride without
  them is not incomplete.
- **Neither feeds the load model.** Load is computed from power
  ([ADR-0016](../decisions/0016-training-load-model.md)) and RPE does not move it.
  Letting it would be its own decision, with its own ADR.
- **Where they travel: nowhere the rider did not put them**
  ([ADR-0055](../decisions/0055-a-shared-ride-carries-numbers-not-words.md)).
  Sharing a ride with friends shares the numbers the trainer recorded; the note
  and the RPE stay on the rider's own account. They are in the account export,
  because they are the rider's own words about their own ride.

There is no separate "feeling" control. The number says how hard and the
sentence says why — a third picker between them would be a setting that most
riders would leave alone, which the 95 % rule makes a default instead.

## Medals (per group session)

- **Diesel** — lowest power variability (coefficient of variation) across steady steps
- **Metronome** — best execution score (each against their own biased targets — see Stats formulas)
- **Hammer** — best 5 s w/kg
- **Lanterne Rouge** — last on the final sprint/podium metric but completed the session (their ride reaches the workout's final segment)
- Ties: earlier joiner wins. Minimum 3 riders for medals (default — tune in alpha).
