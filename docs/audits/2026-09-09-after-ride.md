# Audit: the after-ride flow (2026-09-09)

**Slice.** Everything from the last second of a ride to what the rider does with it afterwards: the solo ride and ramp-test end, the summary, save and recovery (part A); the room session end, recap and the rider's own ride from a room (part B); `/history`, the ride page, the FTP suggestion, export, delete/purge and the Strava delivery status as the rider sees it (part C).

**Excluded.** The riding itself (ERG, BLE, the workout engine, sprints, game rules), the workout editor and preview (#1526 in flight), jukebox, DMs, the desktop shell, voice internals, and Strava *code* (an auto-upload branch owns it — the copy fix in #1567 touches `upload.go` only).

**Method.** Three read-only Explore agents at `42c52583`, one per part, against WATTROOM.md, ARCHITECTURE.md, SPEC.md, ADR-0019/0022/0034 and the rules. Every high and medium finding was verified by reading the cited code before filing. Filing rule: bug or high. Strava payloads never entered any context.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| B1 | A session that closes off-tick dates every room ride at its end (`session.end()` banked nothing; the running→done clamp did not write back) | bug, high | #1533 → **#1556** |
| B9 | An empty room's "ended" line fired at the next visitor | bug | #1534 → **#1556** |
| B2 | A second session in the same room reused the first session's samples in every non-coach summary | bug, high | #1535 → **#1564** |
| B3 | Samples backfilled after the close are recorded and never saved | bug, high | #1536 (open — needs a saver amendment path) |
| B4 | A late joiner never got the "See your ride" link (local clock vs the tick's start) | bug | #1537 → **#1564** |
| B7 | The past-sessions list had one of the four states | drift | #1538 → **#1564** |
| B8 | The ended lounge said "Nothing is running yet" under "The session has ended" | polish | **#1564** |
| B10 | A countdown the coach cancels still leaves a recap | decision | #1539 (`needs-human-input`) |
| A1 | A ramp test was fifteen minutes of riding that never became a ride | not-built, high | #1540 → **#1562** |
| A2/B5 | The recovery card offered back room rides the account already had | bug, high | #1541 → **#1562** |
| A3/B6 | The client's normalised-power floor was 30 s where SPEC says 20 min | drift | #1542 → **#1563** |
| A4 | A failed FTP push reported "Saved" and silently reverted | bug | #1543 → **#1562** |
| A5–A10, A12–A14 | The solo summary's loose ends (leave-path save, saving state, zero samples, execution on nothing scored, device duplicate, "Session complete", kJ rounding, the unused `ftp`, phone-width coverage) | bug/polish | #1544 → **#1563** |
| A11 | A finished solo ride never let go of the trainer | bug | #1546 → **#1563** |
| A15 | `POST /api/rides/export` is the one ride route with no auth | decision | #1547 (`needs-human-input`) |
| C1 | The Strava failure copy sent the rider to a settings page with no Strava on it | bug, high | #1548 → **#1567** |
| C2/C9 | `/history` stopped at 200 rides with no load more; the .fit was named by uuid | bug | #1549 → **#1567** |
| C3/C7 | Export-all omitted medals and four ride fields; a partial archive downloaded as a success | bug | #1550 → **#1569** |
| C4 | The training-load chart labelled every day one early west of UTC | bug | #1551 → **#1568** |
| C5 | Declining the FTP suggestion was forgotten on reload; the prompt lived only in Settings | bug + not-built | #1552 → **#1568** |
| C6 | A failed Strava delivery is invisible until you open the ride | not-built | #1553 (Strava lane) |
| C8/C10 | A rider page that 404s offered a Retry; the ride page's progression fetch failed silently | drift | #1555 → **#1568** |
| C11 | `/api/me/export` has no per-account ceiling | decision | #1554 (`needs-human-input`) |

Not filed: B's note that no end-of-session podium exists — nothing in WATTROOM.md or SPEC promises one.

## Checked and found sound

Recorded so the next audit does not re-derive it.

**Part A — solo ride end.**
- Save-failure classification: only `validation_error`/`invalid_request` are final (`save.ts`); offline, 401 and 500 keep the buffer unfinished and the ride recoverable — verified against every error return in `handleCreate`.
- The #794 seam holds: `buffer.end()` fires only on server acknowledgement, and `stale()` never walks a failed solo save off the `KEEP_RIDES` end.
- The recovery offer can be acted on: `workoutJson` is written at ride start; `uploadPayload` hides Save without it; field names and the `heartRate`/`hr` split are covered by `recovered.test.ts`.
- Double-save is impossible: one `startedAt` for buffer, session and POST; the server dedupes under the rider's row lock via `FindRideAt`.
- Server validation is complete and errors.md-shaped (name 1–80, parseable workout, non-future start, 60 ≤ samples ≤ 21 600, per-sample bounds); list/share cover 401/400/404/500.
- Ramp maths match SPEC (100 W start, +20 W/min, 25 steps, 300 s warm-up, FTP = 75 % of best rolling 60 s, blown at 75 % for 5 s), and the LTHR suggestion (0.90 × max HR) is one tap, never auto-applied.
- Summary formulas other than NP match `engine.go`: zone seconds, power-curve windows, XP `kJ + round(exec × 50)`.
- No sideways-scroll trap: `IntervalGraph` and `ZoneBar` use `viewBox` + `w-full`; the summary grids collapse below `sm`.
- The leave guard is shared by `/ride` and `/ramp` and cancels navigation synchronously.

**Part B — room session end.**
- The recap is written exactly once: five retries inside a 2-minute budget onto an upsert keyed `(room_id, started_at)` with a unique index; `StartedAt` comes from `presentSince` (wall clock), immune to B1.
- ADR-0034's four settled points hold: presence and time only, 90-day retention enforced by housekeeping, members-only via the chat gate, cascade on room and account deletion.
- The empty-room close works and is tested; a rider who left mid-session still gets their partial ride (`seenOrder`, not `clients`).
- Double-save is prevented on all three routes: `rm.saved`, `FindRideAt`, `ownsTrainerLocked`.
- WS down at the close still shows the summary: the connection outlives navigation and the first tick after reconnect carries `done`.
- The end announces itself with sound; the summary is a modal; the medal's big number is the medal's own metric.
- Recap card geometry clamps to the span, floors a bar at 2 %, says "< 1 min"; medals follow SPEC (minimum 3, earlier joiner wins, `Completed` checked).

**Part C — afterwards.**
- Privacy holds: month totals and shared rides gated behind `self|accepted`; `ListSharedRides` requires `shared_at`; room sums and the week board are room-scoped behind the room opt-in plus `on_board`; no HR leaves the rider's own surfaces.
- The FTP rule matches SPEC exactly, and accepting it writes one value through `profile-sync.svelte.ts`; `/ride`, `/ramp` and every room surface read `profile.current.ftp`.
- Charts obey the phone rule (`width="100%"` + `viewBox` + `bind:clientWidth` on the wrapper) and `phone-width.spec.ts` seeds a ride first so they exist.
- Destructive actions follow errors.md: ride delete confirms, sharing is optimistic with undo, purge confirms with a typed phrase; delete/export are owner-scoped with 404-not-403.
- Ride detail has all four states and separates not-found from retryable; empty states teach with the glossary's words; dates and times use the browser's locale and zone.
- `/progression` redirecting to `/history` is ADR-0020's decision, not a defect.

## Lessons for the next run

- A hub `state()` with side effects has more than one caller; a bug that shows only when a rider's message crosses a boundary first needs the test to start the session *off the tick grid* (`synctest` fires the tick and the test's sleep on the same virtual instant otherwise).
- `flushSync()` does not flush an effect created inside `$effect.root` from a `.svelte.test.ts`; `await tick()` does.
- sqlc emits `*int16` for a nullable `smallint`, not `pgtype.Int2`.
- The hidden browser pane's intensive timer throttling starves the simulated trainer below one sample a second; a ride-length flow cannot be verified there.
