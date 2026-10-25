# 0044 — Export completed rides to Garmin through manual FIT import first

- Status: accepted (scope approved by Dave in #801; Garmin import validation pending).
  **Diverged 2026-09-17 (#2330, #806)**: the approval stands as history, but #801 closed
  as not planned on 2026-09-10 and #806, which had consolidated it, closed on 2026-09-17,
  so this line pointed at no live home. The validation is still pending and now lives on
  [#2330](https://github.com/natrontech/wattroom/issues/2330).
  **Diverged 2026-10-25 (#3341, ADR-0088)**: the validation is done, by Garmin's FIT SDK
  decoder in CI rather than a Garmin import. What it showed is in the amendment at the end.
- Date: 2026-09-08

## Context

[#801](https://github.com/natrontech/wattroom/issues/801) authorizes exporting
completed WattRoom rides, starting with manual FIT import and researching official
automatic-upload access. Saved rides already have an owner-only FIT download
(#800), using the same encoder as Strava. Riders need to know how to use that file
and what an import has actually been shown to preserve.

Dated evidence, inspected code, format-check results and the operator's exact
capability/access questions live in
[#1133's research findings](https://github.com/natrontech/wattroom/issues/1133#issuecomment-5587526277).
Garmin's [manual import instructions](https://support.garmin.com/en-US/?faq=Ht3ZP52Kju075uKvqTqu99)
describe the Connect Web import route. Its public
[Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
describes retrieving Garmin activities; its
[Training API](https://developer.garmin.com/gc-developer-program/training-api/)
publishes planned workouts. Neither establishes a completed-ride upload endpoint
for WattRoom. The public program agreement contemplates uploads, so automatic
upload is unconfirmed rather than ruled out. Eligibility and supported access
need Garmin's answer via the official routes recorded in #1133.

## Decision

Use the existing saved-ride **Download FIT** action, with collapsed manual Garmin
instructions beside it. The rider downloads their own completed ride and chooses
to import it in Connect Web. Disclose that the file includes recorded HR alongside
power and cadence, following [ADR-0008](0008-heart-rate-retention.md). This choice
does not create a Garmin connection or a delivery record in WattRoom. The existing
download error/retry and no-samples states remain the source of download status;
WattRoom cannot display Garmin delivery success for a manual import.

Automatic upload requires confirmed supported capability, approved access and a
separately reviewed implementation before any connection/upload UI appears. That
implementation must address destination consent, sealed credentials, deduplication,
uncertain upload outcomes, bounded retries and disconnect/revocation. The existing
Strava worker is destination-specific and cannot process Garmin jobs unchanged.
Do not use password APIs or impersonate a Garmin device to make a file import.

This decision covers completed WattRoom rides only. Planned workouts, outside
history and Apple Health/native work remain outside this scope. Research and
guidance do not authorize contacting Garmin, applying, accessing an account or
uploading a file.

## Consequences

- A file-format check is distinct from a Garmin import. The synthetic fixture
  passes the existing Go tests and Garmin FIT Python SDK 21.214.0 integrity/decode
  checks (120 records, 120 s summary, cycling/virtual activity, sensor summaries).
  **No actual Garmin import was performed.** Do not promise training-status effects.
- Current saved exports flatten samples into consecutive seconds and encode equal
  elapsed/timer durations. Original pauses cannot be reconstructed from that file.
  Garmin's display of duration, timezone and sport remains a manual validation gate.
  Calories are an estimate from mechanical work; distance/GPS are absent.
- The operator's later authorized check must compare a real continuous and paused
  ride: start/timezone, elapsed/timer time, power including zero periods, cadence
  and HR present/absent, energy units, and classification. Keep the source version,
  file hash and observed result private as appropriate. A duplicate-import test
  needs explicit authorization; inspect Connect after an uncertain result before
  retrying. Never change timestamps to bypass duplicate detection.
- Downloading again is possible; Garmin's duplicate behavior is unverified.
  WattRoom has no Garmin connection to disconnect, and deleting a WattRoom ride
  does not remove a copy imported into Garmin. The rider manages that copy there.
- ~~#801 stays open for~~ manual validation and the automatic-upload access gate.
  Timing follow-up [#1140](https://github.com/natrontech/wattroom/issues/1140)
  must preserve actual recording semantics across save,
  recovery and both export paths; it is not solved by fabricating timer events.
  **Diverged 2026-09-17 (#2330, #806)**: #801 closed as not planned on 2026-09-10 with the
  four sibling destinations, and #806, the index that had consolidated all five, closed on
  2026-09-17. Neither gate moved — both now live on
  [#2330](https://github.com/natrontech/wattroom/issues/2330), the manual Garmin import a
  person with a Garmin account has to run.

## Amendment, 2026-10-25 (#3341): Garmin's FIT SDK meets the gate ([ADR-0088](0088-ship-on-research-and-simulation.md))

ADR-0088 meets the validation gate with the FIT SDK's own decoder instead of an import
into a Garmin account. CI's `server` job runs Garmin's Python FIT SDK 21.218.0 over the
export's golden files (`scripts/fit-sdk-check.py`, [#2330](https://github.com/natrontech/wattroom/issues/2330)):
a continuous ride, one with a 30 s pause, and a road ride, all synthetic. Each decodes with
both CRCs intact and carries the Activity file's required messages in summary-last order:
File Id first, then records, lap, session, and activity last. The checklist above, item by item:

- **Start time and timezone:** the start is written in UTC. The activity message has no
  `local_timestamp`, so an importer shows the start in its own timezone.
- **Elapsed vs timer:** a saved ride numbers its samples one per second, so the two are
  equal. The stateless export keeps a pause: 150 s elapsed, 120 s timer. Neither writes timer
  events, which Garmin calls a best practice rather than a requirement.
- **Power:** on every record, 0 W included.
- **Cadence and HR:** a zero is left out as not measured, so a ride without a strap has no
  heart rate at all.
- **Energy:** `total_calories` is the kJ of mechanical work, rounded down, read as kcal.
- **Classification:** cycling / virtual_activity.

What Garmin Connect displays for each item is still unobserved. Under ADR-0088 that no
longer holds the gate, and a rider's report after release is how a difference would surface.
The shared gate [#806](https://github.com/natrontech/wattroom/issues/806) named for every
export destination, a WattRoom FIT validated through one manual import, is lifted on these
terms: the encoder's own output, from synthetic rides, through Garmin's decoder. Whether a
closed destination comes back is a roadmap question, and this amendment does not decide it.
