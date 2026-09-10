# 0049 — FTP history is the ride-time record, plus what a ramp produced

- Status: accepted
- Date: 2026-09-10

## Context

The FTP trend chart's line is built from `rides.ftp_watts` — the FTP each ride
was *scored against*, stamped on the row when the ride is saved. That is the
component's founding rule ([#222](https://github.com/natrontech/wattroom/issues/222)):
history, not reconstruction. Nothing recomputes it, so it cannot drift when a
rider edits their profile, and a ride's number always agrees with the score
beside it.

A ramp test is now a ride ([#1562](https://github.com/natrontech/wattroom/issues/1562)),
and that exposed the gap. The ride is saved the moment the test ends, before
the rider has accepted anything, so its row carries the *old* FTP — the one the
test exists to replace. The chart therefore could not show a ramp's result
until the rider rode again, which is how
[#1572](https://github.com/natrontech/wattroom/issues/1572) was reported: on a
fresh account the chart drew a flat line, no dots, and "9 Sept – 9 Sept".

Two sources were defensible, and they mean different things:

1. **The ride-time record.** What the chart has always drawn. Complete for
   every ride, silent about the moment an FTP changed.
2. **FTP-change events.** `ftpMeasuredAt` already exists on the profile and
   `saveFtp()` already sets it; an `ftp_changes` table written by every FTP
   save would be the honest change history, and the line would come from it.

The insufficient-data state — teaching copy instead of a flat line — shipped
first and is independent of this choice.

## Decision

**The ride-time record stays the only source of the line.** One nullable
column, `rides.ftp_after_watts`, records the FTP a ride *produced*; the trend
draws it as its own mark (a diamond in `--color-watt`, distinct in shape from
the `best20m` dots) on the ride that produced it.

Only the ramp writes it, through `PUT /api/rides/{id}/ftp-after`, and only once
the rider has pressed Save on the number — so a test whose result was declined
leaves the column null, which is the truth: that FTP never took effect. Every
ordinary ride leaves it null for good; nothing backfills ramp rides saved
before this, because the number they produced is not recoverable from the row.

An `ftp_changes` event table is **rejected** for now: it buys a change history
that nothing yet asks for, at the cost of a second definition of FTP history
and a table every profile write has to keep honest.

## Consequences

- A ramp test shows up on the chart the same day, instead of a ride late.
- The chart says two things at once, and has to keep saying them separately:
  the line is the FTP a ride was *scored against*, the diamond is what a test
  *measured*. The legend and both surfaces' captions carry that, and a mark
  that ever gets folded into the line loses it.
- A rider who changes their FTP by hand — the profile form, an accepted
  suggestion — still leaves no mark. The line catches up on their next ride,
  as it always has. That is the accepted limitation of choosing (1); it is what
  an `ftp_changes` table would fix.
- The column is per-ride, so it is deleted with the ride and exported with the
  account like every other ride fact — no new privacy surface (ADR-0008).
- Expand/contract (ADR-0019): added nullable, nothing dropped, so the previous
  release's code reads the table unchanged and a rollback is still an image
  tag.
- **Revisit trigger**: the first feature that needs to know *when* an FTP
  changed independently of a ride — a "your FTP over time" export, a coach
  seeing a rider's test history, an auto-applied suggestion — is the one that
  should build (2), and it inherits this column as the ramp's half of it.
