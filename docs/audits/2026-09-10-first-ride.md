# Audit: the solo first-ride path — 2026-09-10

**Slice.** What a brand-new rider walks on their first evening, alone: the `/workouts` shelf's way into a ride, `/ride` in every pre-ride state (pairing, the simulator, a strap), the start, the mid-ride controls and guards, a trainer dropping out, the end, the summary, the save and the crash-safety buffer; `/ramp`; `/settings/equipment`.
**Excluded** (audited the same night): rooms and everything under `/r/`, the training-data pages, the workout library and editor, crews, friends, presence, HUD/TV.
**Method.** One Explore agent at `2101d80c`, read-only against WATTROOM.md, docs/SPEC.md, docs/HARDWARE-SESSIONS.md, ADR-0046 and the rules; the three highs and the completion path verified by reading the cited code before filing. Nothing was run against hardware.

## Filed

By the rule *bug or high*; the decision carries `needs-human-input`.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| #1792 | A solo ride announces nothing but a block change — auto-pause, the resume count, the spiral release, a dropout and the end are silent | high | fixed (#1805) |
| #1793 | A sprint block on the solo screen reads "no target — spin easy" for its whole window | high | fixed (#1803) |
| #1794 | The ramp's blown-detector reads a dropout's frozen samples, and a spiral release, as the rider blowing up — then offers the FTP | high | fixed (#1801) |
| #1795 | A ride that finishes on its own keeps the trainer, the wake lock and the recorder | bug | fixed (#1802) |
| #1796 | A spiral release is excluded from the live score but scored on the saved ride | bug | open — needs `released` on the sample, both paths |
| #1797 | "Test again" links to the page you are on and does nothing | bug | fixed (#1801) |
| #1798 | Auto-pause and the spiral guard count samples, not seconds | bug | fixed (#1802) |
| #1799 | Polish: a dropout with no button, the ramp without status/flag/TV, Skip on the last block, the equipment reading in a room, three ramp durations, a stale ponytail note | medium/low | partly: Skip and the kit classes (#1803), the ramp length (#1801) |
| #1800 | Decision: a solo ride starts its clock the instant Start is pressed — no countdown | decision | `needs-human-input` |

Already filed and not re-reported: #1547 (`POST /api/rides/export` has no auth), #1400 (a ramp is saved as a ride now — the issue reads answerable), #1635 (skip/extend in a room), #1484 (the FTP 200 W / 75 kg default nobody chose).

## Checked and found sound

- **Crash safety end to end.** `buffer.end()` fires only on server acknowledgement (`ride/+page.svelte`), `stale()` protects up to `KEEP_RIDES` unconfirmed rides from being pruned by room joins, `unfinishedRides` filters on `MIN_SAMPLES`, and `uploadPayload` refuses to offer a ride it cannot save (`recovered.ts`). `save.ts`'s `final` classification keeps only `validation_error`/`invalid_request` off the recovery card, so offline and 5xx stay recoverable.
- **Double-save is impossible.** One `startedAt` threads the buffer, the session and the POST; the server dedupes under `LockUser` + `FindRideAt` (`rides.go`).
- **The workout clock and the score agree with the server.** `clock` is stamped per sample (#1733), validated and keyed on in `engine.go`; `bias` rides along with matching 0.8–1.2 bounds on both sides; `Pedalling()` is exactly `guards.pedalling`.
- **SPEC's numbers live in one place each** — `RAMP` (`ramp.ts`), `DEFAULTS` (`guards.ts`), `toleranceBand` — and match docs/SPEC.md.
- **One trainer, one owner.** `soloTrainer()` is a singleton above the router; `pair()` releases before attaching and takes the hardware back from a room; `handOff()` transfers the live connection without a second `connect()`. `/ride`, `/ramp` and `/settings/equipment` read the same object.
- **Pairing has all four states in one mapping** (`sensor-card.ts`), never a control that would fail; `pair-error.ts` rewrites Chromium's `NotFoundError` into something a rider on a bike can act on.
- **Sensor arbitration is honest** (`arbitrate.ts`): a source quiet past 5 s is dropped and heart rate is undefined rather than 0 bpm; `SecondaryRow` hides the cell rather than showing a zero.
- **The tick survives a hidden tab** (`ticker.ts` blob worker, reporting the seconds it actually covered).
- **The leave guard is shared and cancels synchronously** (`leave-guard.svelte.ts`), covers `/ride` and `/ramp`, pairs with `beforeunload`.
- **The flight recorder never sends HR** — `tick()` copies fields by name for that reason; the ⚑ consent line is shown at the moment of the tap.
- **Every fetch goes through the one wrapper** and handles failure as a value; the save outcome is persistent status, never a toast, until the page is gone.
- **The shelf handoff has its four states**; `selected` is `$derived` so an async shelf no longer falls back silently.
- **Phone width is covered where it matters**: `ride-narrow.spec.ts` at 375 px including the last control; `phone-width.spec.ts` lists `/workouts`, `/ride`, `/ramp` and `/settings/equipment`.
- **`POST /api/rides` validation is complete and errors.md-shaped**; `stats.Execution` and `Scorable` match SPEC including #1143's three cases; the `.fit` boundary rejects unordered or out-of-range samples with rider-readable sentences.

## Not checked

- **Real BLE behaviour**: whether the alpha's trainers notify at 1 Hz (which decided how much #1798 bit), how a real dropout looks in the reattach backoff, and whether the ERG→slope flip produces a rideable sprint. docs/HARDWARE-SESSIONS.md is the instrument.
- **Sound**: whether the cues are audible over a fan at 3 m and mixed sensibly under a jukebox — #1792's fix needs a listening pass (#152).
- **Whether a spiral trip during a ramp is common enough to matter** — the code path is certain, the frequency is not.
