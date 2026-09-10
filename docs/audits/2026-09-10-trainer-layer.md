# Audit: the trainer and sensor layer — 2026-09-10

**Slice.** Everything between the browser's Bluetooth API and the ride session: the `Trainer` interface and `FtmsTrainer` (the control point, the 0x80 indications, ERG and slope writes, the Indoor Bike Data parser), the simulator, the sensors (heart-rate straps, cadence), `arbitrate.ts`, the device picker, the reattach and backoff, the solo trainer singleton, the room's trainer path, and the session's use of the trainer (`applyTarget`, the guards' actuation, the wake lock, the ticker).
**Excluded** (audited earlier the same night): the riding screens' UI, the recording and scoring, the summary, the crash-safety buffer, rooms' UI, presence.
**Method.** One Explore agent at `bd8b9598`, read-only against WATTROOM.md, docs/HARDWARE-SESSIONS.md, docs/RESEARCH.md §9/§11–§13, docs/SPEC.md, ADR-0007 and ADR-0025; the three highs verified by reading the cited code before filing. Nothing was run on hardware.

## Filed

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| #1846 | A trainer that reattaches mid-block never gets its ERG target back (room) | high | fixed (#1854) |
| #1847 | The mid-ride recovery card is wired to a trainer the session no longer holds | high | fixed (#1856) — a regression from #1808 the same night |
| #1848 | The 0 W release before disconnect is guaranteed never to reach the trainer | high | fixed (#1854): the driver writes the release and awaits it before dropping the link |
| #1849 | An Indoor Bike Data frame with no power field is thrown away whole; a never-power trainer is told to turn the cranks | bug | open |
| #1850 | Control-point indications are not matched to the op that was written | bug | open |
| #1851 | Starting on a reconnecting trainer opens a second chooser and stacks a listener; pairing in a room does not take the trainer back from the solo slot | bug | half fixed (#1856: Start waits, one device, one listener); the room half open |
| #1852 | Polish: the attach race on Forget, the room's silence detector blind without ticks, the sprint's second step after the release, two docs describing three drivers | low | open |
| #1853 | Decision: a tab whose trainer claim the hub refused keeps writing ERG targets (ADR-0025) | decision | `needs-human-input` |

Cited rather than re-filed: #4 (WcpsTrainer), #806, #1799.

## Checked and found sound

- **The control-point queue** — serialisation behind the 0x80 indication, the caught tail that stops one failure poisoning the session (#518), target supersession so a release jumps the queue (#790), the generation counter that drops writes addressed to a dead grant, the timeout that always clears its own slot; all pinned in `ftms.test.ts`.
- **The Indoor Bike Data parser's traps** — inverted bit 0, bit 2 against the spec typo, half-rpm cadence, SINT16 power, the average-power skip before HR — matching RESEARCH §11 and tested field by field.
- **Width-defensive capability reads** (`parsePowerRange`, `clampTarget` on the increment grid) with the Kickr Core's real bytes as a test; Machine Status 0xFF re-requests control through the queue.
- **Listener scoping across reattaches** — one `AbortController` per attach in the trainer and the sensors, with tests that one frame stays one sample after a reconnect.
- **HR parsing** (variable RR intervals, energy-expended skipped in place, the format bit) against the Polar H10 capture; **cadence from cumulative revolutions** with rollover, the stopped-rider case on the wall clock, an rpm ceiling, and a tracker rebuilt per connection.
- **Arbitration** — TrainerRoad's ranking as-is, staleness at 5 s, `0 rpm` as a report rather than an absence, heart rate `undefined` rather than 0.
- **The guards read seconds, not samples**, on both paths (#1798), and `DEFAULTS`, `REVOLUTION`, `ARBITRATION` each live in one file with the docs' numbers.
- **A malformed sensor packet cannot take the ride down**; raw bytes are logged beside the parse; `hwlog` is dev-only and never throws, and `vite.config.ts` really appends to `.hwlog/session.jsonl`.
- **The ticker** (blob worker plus the wall-clock delta), **the wake lock** (re-requests on `visibilitychange`, refusal non-critical), **`canSimulate()`** in one place, the four-state pairing machine that never renders a control that would fail, `pair-error.ts`'s rewrite of Chromium's `NotFoundError`.
- **The desktop picker** — a streamed scan, a 20 s timeout that stops on the first device, the warm-up suppressed, `/dev/pairing` driving the same component.
- **`SimulatedTrainer`'s replay mode** — deterministic, so a feedback report converts into a regression test.
- **WATTROOM.md's hard rule holds** — `navigator.bluetooth` appears only in `ftms.ts`, `sensor.ts` and `enumerate.ts`.

## Not checked

Everything below needs the session docs/HARDWARE-SESSIONS.md describes.

- Notification rate and whether frames are split (More Data) — `frames` vs `poweredFrames` on `/dev/hardware` answers it in one ride; #1849 turns on it.
- What a real dropout looks like in the backoff on Chrome/macOS and Chrome/Android, and how long the first successful retry takes.
- Whether a Kickr holds its ERG target after the link drops — decides how much #1848 mattered.
- Ack latency under load; the 3 s timeout and #1850's late-indication race bite only past ~200 ms on a congested radio.
- Whether the ERG→slope sprint flip and its 500 ms gap are rideable; Kickr cadence dropping out on sprint→easy; two tabs on one trainer; Bluetooth coexistence with BT-Classic audio.
