# 0016 — Training load: Coggan math, trademark-safe names, nudges never gates

- Status: accepted
- Date: 2026-08-31

## Context

#222 adds a progression/training-load layer. The research pass
([RESEARCH.md §13](../RESEARCH.md)) settled three things that needed deciding
before code: which model, what to call it, and how it may speak to a rider.

The industry-standard model (Coggan's normalized power → training stress →
42/7-day impulse-response chart) is published, freely implementable math — but
**TSS, NP, IF, CTL, ATL and TSB are Peaksware (TrainingPeaks) trademarks**;
GoldenCheetah was made to rename its metrics. Every novice-friendly product
(intervals.icu, Strava) also renamed the concepts for legibility, not just
legality.

## Decision

**The math**: Coggan's, exactly as published, constants in
[docs/SPEC.md](../SPEC.md) (Training load section) — 30 s rolling 4th-power
NormPower, Load = Intensity² × hours × 100, Fitness/Fatigue as 42/7-day EWMAs
of daily Load, Form as yesterday's difference. No invented alternative, no ML.

**The names**: **Load, Intensity, Fitness, Fatigue, Form** — the intervals.icu
convention, which doubles as the most legible naming in the space. The
trademarked acronyms never appear in UI, API, or protocol.

**Form is a percentage of Fitness**, with intervals.icu's five zones
(SPEC has the bands). Absolute band numbers assume a ~100 Load/day athlete;
percentage form keeps the bands meaningful for 4-hour/week riders.

**Storage**: one new summary column, `norm_watts`, computed at save time.
Existing rides are backfilled by a one-pass startup job that reads each blob
once — consistent with WATTROOM.md's "samples are only ever read per-ride"
(each ride is read exactly once, then the blob goes cold again). Load and the
EWMA series are derived on read, never stored.

**Honesty and tone are part of the model**:

- Every load surface is scoped "based on your WattRoom rides" — with no
  outside-activity import (Strava read was de-scoped on #222), absolute
  fitness claims are indefensible; scoped ones are fine.
- Cold start: load-derived status hides for the first 28 days of ride history
  (SPEC) — a 42-day average over a week of data misreads as a dangerous ramp.
- Zone words describe the day, never grade the rider (Garmin's "Unproductive"
  is the documented cautionary tale). Suggestions carry a one-clause why and
  never gate a workout.

## Consequences

- Load inherits FTP staleness: a wrong FTP corrupts Intensity, Load and the
  whole chart. The counter is the already-shipped FTP prompt plus a future
  curve-derived estimated FTP (research §13.1); until then the FTP-suggestion
  nudge is the guard.
- Percentage form diverges from what riders see on TrainingPeaks (absolute
  TSB). Accepted: our audience overlaps intervals.icu users, who already see
  percentages.
- Daily buckets are UTC. A late-evening ride can land on "tomorrow" for a
  CET rider; accepted at alpha scale, revisit only if riders actually notice.
- The 28-day cold start means new riders see charts before they see verdicts.
  That is the intended order: numbers first, opinions once they mean something.
