# Audit: test and CI reliability (2026-09-09)

**Why.** A docs-only release PR went red on `TestExportEmptyAndCorruptSamples/corrupt` and blocked the .83 tag; earlier `TestRideListPagesByStart` had flaked (#1598); two e2e runs on main burned five minutes on one click.

**Method.** One read-only Explore agent over the test trees, the CI workflow and the last 100 runs on main (`gh run list`, `--log-failed`), with the failing fixture reasoned through rather than re-run.

## Findings and where they went

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | `rideBody` re-read the wall clock per call at second resolution: two saves collide whenever the gap crosses a second, and the server dedupes the second as a retry (200) — the root of all three server flakes | high | **#1717** (one base read once) |
| 2 | The `.83` failure was finding 1, not the corrupt blob (which is deterministic) | high | **#1717** |
| 3 | Playwright `retries: 0` with a 5-minute timeout turned a startup wobble into a blocked release, twice | high | **#1717** (`retries: 2` on CI) |
| 4 | The riding-screen phone test was duplicated across projects | medium | already resolved by #1662 |
| 5 | Six `waitForTimeout` bets on layout and sample timing | medium | **#1717** (the three sweeps poll; chat sleeps with margin); replay/ride → #1718 |
| 6 | `budget_test`'s 30 ms window / 40 ms sleep | low | **#1717** (200 / 400) |
| 7 | Unlocked fake sinks in `av` and `rooms` tests, the shape of the #1645 race | low | #1718 |
| 8 | No `-shuffle`, no `-timeout` on the Go suite | medium | **#1717** |
| 9 | CI's `WATTROOM_TEST_DB` names the dev database's name | low | #1718 |

## History on main (last 100 runs)

Three failures: `TestBestRideOfWorkout` (finding 1, run 34398342446) and `phone-width.spec.ts › the riding screen … on a phone` twice (finding 3/4, runs 34393844504 and 34392754415). Everything else was green or cancelled by PR concurrency.

## Checked and found sound

- No `t.Parallel()` anywhere; room slugs are package-prefixed and distinct (the #1657 collision has not recurred); counter-derived slugs where reuse is likely.
- Every `:many` query has an `ORDER BY`; cleanups cascade from the user row and use `context.Background()`.
- `synctest` bubbles pair every long sleep with a `Wait()`; most handler-facing fakes are locked.
- The skip-vs-fail contract (`WATTROOM_REQUIRE_DB`) is enforced; concurrent migration is covered by a real fresh-database test; Playwright always rebuilds.
