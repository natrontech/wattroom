# Audit: the training-data surfaces (2026-09-09)

**Slice.** What a rider reads off the bike: `/history` (list, pagination, recovery card, FTP prompt), `/history/[id]` (stats, curve, trace, share/export/delete/Strava), `/progression` (the load model of ADR-0016 and SPEC's formulas), `/sessions` and the calendar feed, `/rooms/directory`, and the server behind them (`rides/`, `stats/`, `progression/`, the calendar and directory handlers).

**Excluded.** The recording path and the after-ride save flow (audited the same day), Strava upload (2026-09-08), the room's own sessions place, the workout editor, friends, crews, auth.

**Method.** One read-only Explore agent at `712ec5c2` against WATTROOM.md's privacy row, SPEC's stats and load sections, ADR-0008/0016/0021/0024/0034 and the rules. Every medium finding verified by reading the cited code before filing; the endpoint added for finding 1 was checked live in the dev app.

## Findings and where they went

| # | Finding | Kind | Disposition |
|---|---|---|---|
| 1 | The ride comparison scanned one page of rides and called a year-old workout a first | bug | #1687 → **#1701** (`GET /api/rides/best`) |
| 2 | A chart drilldown to a ride past the first page did nothing | bug | #1687 → **#1701** (pages forward, then rings) |
| 3 | The load surfaces dropped ADR-0016's scoping sentence | drift | #1692 → **#1701** |
| 4 | The load tooltip showed absolute form under the header's percentage label | drift | #1690 → **#1701** |
| 5 | The ride page could not share the ride it showed, or say whether it was shared | not-built | #1691 → **#1705** |
| 6 | The ride's own power curve was stored and exported but never shown | not-built | #1691 → **#1705** |
| 7 | The calendar feeds carried no `Cache-Control` | privacy | #1688 → **#1701** |
| 8 | NormPower's 30 s window and 20-minute floor were pinned by no test | tests | #1692 → **#1701** (252 W over a 300→100 W step; 1199 samples = the average) |
| 9 | The cross-room schedule payload is computed for Home and thrown away | drift | #1693 (`needs-human-input`) |
| 10 | A room listed between two directory pages crashed the keyed list | bug | #1690 → **#1701** |
| 11 | Day labels were a day off at UTC+13 and beyond | bug | #1690 → **#1701** (date parts, not an instant) |
| 12 | Progression's cold start measured from the oldest ride in the window; the 1000-row cap dropped the newest | bug | #1689 → **#1701** |
| 13 | The day drilldown snapped to a ride weeks away | polish | #1692 → **#1701** (±3 days, else a toast) |
| 14 | A Strava error string was rendered verbatim | polish | #1692 → **#1701** |
| — | The five form zones had no boundary rows | tests | #1692 → **#1707** |

## Checked and found sound

- **The formulas.** NormPower's window arithmetic (first mean at `i == window-1`, eviction at `i >= window`), Load = I²·h·100, FitnessSeries applying form before the day's update, FormZone's five inclusive bands, the curve windows, the category rule, XP and the FTP suggestion — all match SPEC (`stats/load.go`, `stats/engine.go`, their tests).
- **`SuggestToday`** follows SPEC's five rules in order, first match wins, why-clauses verbatim; the badge gates nothing (ADR-0016's tone rule).
- **Heart rate never leaves its owner.** `ListSharedRides` selects name/time/seconds/kJ/execution/medals only; the rider page gates shared rides on `self | accepted`; `GetRide` is owner-scoped, so a shared ride's id is not a door to its samples (ADR-0008).
- **Ride detail 404/403, delete cascades** (medals, exports) — tested.
- **The directory** shows slug/name/icon ordered by name, signed-in only; #1671 holds — every write to `listed` is `and crew_visible`.
- **Calendar tokens**: ~122 bits, constant-time compare on the room token, owner/self rotation, old links die at once; the feed carries planned sessions only (ADR-0021).
- **Phone width**: every progression chart is `width="100%"` + `viewBox` + `bind:clientWidth` on the wrapper; both history routes are in the phone sweep.
- **errors.md**: no `Message: err.Error()` anywhere in the slice.

## Decisions surfaced

#1693 (Home's "What's next": one row per room, or one per session with RSVP); #1694 (the load model's UTC day buckets now that `users.timezone` exists; a unique index behind the rides cursor).
