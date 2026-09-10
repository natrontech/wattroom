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
  **Diverged 2026-09-10 (#1694)**: `users.timezone` now exists and #1657 put the rider page's
  month on it, so the revisit condition is half met — held at UTC here deliberately, with the
  inconsistency written down; see the first amendment below.
  **Superseded 2026-09-10 (#2063)**: daily buckets are the rider's own zone, falling back to
  UTC. This bullet is the history, not the behaviour; the second amendment is the rule, and
  docs/SPEC.md states it.
- The 28-day cold start means new riders see charts before they see verdicts.
  That is the intended order: numbers first, opinions once they mean something.

## First amendment, 2026-09-10 (#1694): the timezone column exists, and Load still buckets at UTC

> Superseded by the second amendment below (#2063), which moved the rider-scoped buckets.

The bullet above says to revisit "only if riders actually notice". Nobody has, but the ground moved anyway: `users.timezone` exists, and #1657 already moved the rider page's month onto it.

**Daily Load (`progression.go`), the streak week (`queries/rides.sql`) and the achievement clock stay UTC.** Not because UTC is right, but because moving them is a change to numbers riders already have — a streak that has been counting one way should not silently re-bucket — and nothing has been reported. A 21:00 CET ride still lands on tomorrow's Load.

What this amendment fixes is the record, not the behaviour: the revisit condition should not read as unmet when the column it was waiting for is already in the schema and already used one surface over. **The surfaces now disagree with each other**, which is worse than either answer alone, and that is the thing to fix when this is picked up — filed as #2063 rather than left as a footnote here.

## Second amendment, 2026-09-10 (#2063): the rider's day wins, and the migration worry was misplaced

The amendment above held UTC because "a streak that has been counting one way should not
silently re-bucket". Picking it up, that reason turns out not to apply to the surfaces it was
protecting — so the rider-scoped buckets move to the rider's own zone, and
[docs/SPEC.md](../SPEC.md) now states the day boundary rather than leaving it to be inferred
from the code.

**Why re-bucketing was safe after all.** The worry was about a number a rider watches
changing under them. Checked one surface at a time:

- **The rider streak is not displayed anywhere.** SPEC's 2026-09-10 amendment (#2049) split
  the two streaks: the **room** streak is the one on screen, and the **rider** streak only
  feeds the XP bonus. So there is no visible count to shorten. What changes is the bonus on
  *future* rides; every past ride's XP is already stored on its own row and is not recomputed.
  And in the case that prompted this, the rider's number goes **up**, not down — UTC had been
  collapsing a Monday-00:30 ride into the previous week and paying half.
- **Load is derived on every read.** Nothing about it is stored, so there is nothing to
  migrate; the chart simply starts drawing the rider's days.
- **Achievements are paid once and never revoked.** `user_achievements` is the record and
  `evaluate` only ever awards, so a count that shifts by one at the boundary cannot take a
  trophy off a shelf.

No migration, therefore, and no grandfathering: the expand/contract rule
([ADR-0019](0019-tagged-releases-and-a-self-converging-vm.md)) has nothing to contract here.

**What stays UTC, and why it is a different question.** A room's week, month, session days and
week board are unchanged. A room's riders are in several zones and a room has no zone of its
own, so there is no rider's day to use — choosing one would mean either giving rooms a
timezone or picking the owner's, and neither is a consequence of this decision. Left open in
#2063 rather than guessed at. The lounge XP cap also stays a UTC day: it is applied inside the
insert as five-minute blocks land, which makes it a rate limit on a live meter rather than a
figure a rider reads back against their own calendar.

**One helper decides the zone.** `server/internal/stats/zone.go` resolves `users.timezone`
once — nullable, so UTC for a rider whose browser never reported one — and hands the same
answer to Go and to Postgres. The bug the 2026-09-09 audit found was a query truncating in one
zone while `stats.WeekStreak` re-bucketed in another; that seam is now one function rather
than two hardcoded strings that have to be kept equal by hand.
