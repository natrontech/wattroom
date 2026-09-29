# Hardware sessions

How to get protocol facts out of a real trainer and back into the repo. Written so
someone with the hardware and no context — or their coding agent — can run a session
without reading the rest of the docs first.

Every session produces the same artefact: a JSONL file plus a comment on the issue.
Nothing here needs the person running it to write code.

## What you need

- The trainer, awake (spin the cranks — most units sleep and will not advertise).
- **Chrome or Edge on desktop.** Web Bluetooth does not exist in Safari or Firefox
  and is not coming; there is no workaround.
- The repo, and `make dev-web` running.
- Nothing else paired to the trainer at the same time. Close Zwift, the Wahoo app,
  and any other tab holding a connection — BLE trainers accept **one** control
  connection, and a second one silently fails or steals it.

## Running it

```bash
make dev-web
```

Open <http://localhost:5174/dev/hardware> (`make dev-web` prints the port it took — a worktree gets its own).

Everything is logged to `web/.hwlog/session.jsonl` as it happens. That file survives
page reloads and browser restarts, and it is the deliverable — you do not need to
screenshot anything or copy numbers by hand.

### 1. Dump GATT (do this first, on any unfamiliar trainer)

Press **Dump GATT** and pick the trainer. This connects without filtering to any
particular service and walks everything it can see.

It answers the only question that matters for a new unit: **does it speak FTMS, or
does it need a proprietary driver?** The badges at the top say so directly, and
Device Information decodes to readable text, so the firmware revision comes out too.

One real limitation, stated on the page as well: Web Bluetooth only exposes services
declared up front, so a service missing from the dump means *"not one we asked for"*,
not *"not there"*. The probe list lives in `web/src/lib/ble/enumerate.ts`.

### 2. Ride it (only if the dump showed FTMS)

- **Pair trainer**, then pedal. Confirm watts, cadence and virtual speed move and the
  sample counter climbs about once a second.
- **ERG**: hit a few targets. The trainer should hold each one *regardless of gear* —
  that is the whole point of ERG. Watch **ack ms**: under ~200 ms means the protocol
  is healthy, and any lag you feel is the trainer's own ramp.
- **Slope**: try 2 % and 5 %. Expect this to feel harder than outdoors if the bike is
  in a big gear — resistance is computed from virtual speed, so a tall ratio makes a
  gentle grade expensive. Watch the kph readout to see why.
- **Worth provoking deliberately**: a hard sprint followed by easing off. Wahoo
  cadence is firmware-estimated and is reported to drop out on exactly that
  transition (RESEARCH.md §11). Whether it does is a real open question.
- **A minute of raw frames** (#3377): ride a steady minute and send it back.
  Every `sample` line in the log carries `raw`, the Indoor Bike Data
  notifications it was read from as the trainer sent them. One captured frame
  pins this unit's flag layout in a parser test, where a re-encoded reading
  cannot.

### 3. The route checklist (#3025, on every trainer a road will ride)

Roads ride in SIM at a felt grade, so this is what decides SPEC's "Route rides"
numbers (#3351). Hold **one real gear and a steady cadence** throughout unless a
step says otherwise; everything below logs itself.

- **Cw factor.** At **0 %**, ride three steady powers (about 150, 200 and 250 W)
  for a minute each. Speed against power at a known Cw is how the pace model's
  CdA and the Cw FTMS sends become one number; the ½ρ factor is measured here,
  not assumed.
- **Cw steps.** Run the **Cw steps** probe: 0.51 → 0.33 → 0.26 → 0.51 kg/m at 0 %,
  30 s each. Power should drop at each step down and recover at the last.
- **Grade slew.** Run the **grade slew** probe: 0 → 8 % at the felt grade's
  1 %/s, a 20 s hold, and back. Note any surge or lag in the resistance.
- **Rider weight.** Does the trainer read one (User Data Service in the GATT
  dump) or assume one? The dump answers the first half; the Cw-factor speeds
  the second.
- **SIM ↔ ERG.** Alternate **Slope 5 %** and **ERG 200 W** a few times, as a
  road step and an ERG block would. Watch for a power spike on the switch.
- **A road sprint.** At **Slope 2 %**, switch to **8 %** for 15 s, then back to
  2 %. Note how the return feels.
- **The single-speed flip.** At **Slope 2 %**, set ERG to twice your FTP for
  15 s, then back to **Slope 2 %**.
- **A long descent.** **Slope −5 %** (the felt floor) for ten minutes. Does the
  trainer stay rideable, or spin out?

#### Shifting by key (#3329)

Anything that types keys shifts, because a browser cannot tell it from the
keyboard: a presentation clicker (most send PgUp / PgDn), a foot switch, an
8BitDo Micro in keyboard mode, BikeControl in keystroke mode. Harder is `.` `+`
`=` Numpad+ PgUp, Easier is `,` `-` Numpad− PgDn. In BikeControl, pick the
**Rouvy** or **TrainingPeaks Virtual** keystroke preset: both send `,` `.` `-`
`+`, so WattRoom needs no preset of its own. Try it in a free ride on a grade
(a gear) and in an ERG workout (the bias), and note for each device:

- one tap is one step, never two;
- a held button steps again after about 0.4 s, then every 0.2 s, and stops the
  moment it comes up — the device's own auto-repeat adds nothing;
- switching to another window mid-hold stops it too.

### 4. The virtual-gears checklist (#3331, on both Kickrs)

What the virtual gears assume and only a trainer can answer (ADR-0084): the
**Gears** probe on `/dev/hardware`, one button per step. Close Zwift first
and never touch the ZAP service. Unless a step says otherwise, ride **85 rpm
±3 in one real gear**, in 30 s blocks. Every write is logged with its op,
grade, Crr, Cw, wind, circumference, k and the time since the press, and
every sample beside it; the route checklist above shares the Cw steps, so run
both at one sitting.

| Step | What runs | Passes when |
| --- | --- | --- |
| **P1** real ratio | 60 s each at 70, 85 and 100 rpm at 0 %, then at 5 %. With a cassette, in 3 real gears. | Within ±5 % of the teeth ratio. Report the per-sample noise: above 2 %, the detection window goes to 9. If the ratio at 5 % differs from 0 % by ≥ 5 %, detection ships off. |
| **P4** mass | Grade 0 → 2 → 4 → 0 %. | m_t from a fit with R² ≥ 0.95. |
| **P2a** Crr | 0.004 → 0.008 → 0.004 at 0 %. | Within ±25 % of the model; say which drag convention holds. Under 5 W of change means the field is ignored. |
| **P2b** Cw | 0.51 → 0.77 → 0.33 → 0.26 → 0.51 at 0 %. | As P2a. |
| **P5** circumference | 2096 → 4192 → 1048 → 2096 mm, at 5 % and at 0 %. | Classify it: full, aero-only or display-only. |
| **P6** shift step | ×1.0907 and ×1.5, up and down, 10 of each, 15 s apart, at felt 3 %. | Acks p95 ≤ 250 ms, ≥ 90 % of the modelled step in the first full sample, and your feel rating for each. |
| **P7** writes per shift | The P7 button counts the writes of the last P6 run. | Exactly one 0x11 per shift and no mode change; power never more than 10 % below min(before, after). |
| **P8** burst | 5 presses within 1 s, three times. | Writes ≤ presses, one in flight, the final params equal the target, no timeouts. |
| **P9** torque ceiling | Felt 10 % in gear 1, the smallest practical real gear, 60 rpm. | Within 10 % of the model, or a documented saturation line. |
| **P10** sprint | Up 4, a 10 s sprint, down 4, three times. | Cadence never 0 while power is above 20 W. |
| **P11** descent | 2 min at felt −5 % in the top 3 gears, then grades of −2, −5 and −10 %. | Within ±15 %, or a documented floor. The lowest grade rendered becomes MinTrainerGrade. |
| **P12** Core 2 only | ERG 200 W, then felt 3 %, with a Cog or Click present. | FTMS control is unaffected. |

Then hand back the file with a few sentences on feel: is a flat-road shift
too harsh (+27 %)? Are 24 gears about 9 % apart right? Are the top and bottom
gears useful?

### 5. Hand it back

Post `web/.hwlog/session.jsonl` on the issue — attach it, or paste it if it is small.
Add a sentence or two on how it *felt*, especially anything that felt broken. The
file has the numbers; it cannot tell us that ERG felt sluggish or that a grade was
unrideable, and those turn out to matter.

Rode it in the desktop app? Attach the shell's own log too. It holds every warning the
app printed, with the time, and `main.old.log` beside it holds the one before:

- macOS: `~/Library/Logs/WattRoom/main.log`
- Windows: `%APPDATA%\WattRoom\logs\main.log`
- Linux: `~/.config/WattRoom/logs/main.log`

## For the agent helping with this

The log is JSONL, one object per line, `kind` being `sample`, `event`, `control-ack`,
`gatt-dump`, `probe` (one per probe second: the road written, and the watts,
cadence and speed reported) or `page-loaded`. Useful things to compute rather than eyeball:

- **ERG settling time** — seconds from a `set target power` event until `watts` sits
  within ±5 % (floor ±10 W) of the target. Compare against the ack latency: if acks
  are fast and settling is slow, the trainer is ramping and there is no bug.
- **Cadence dropouts** — samples with `cadence: 0` while `watts > 20`, and what
  transition preceded them.
- **Slope sanity** — mean watts against virtual speed. A road-load model at the
  commanded grade should land within roughly 10 %; further off suggests the payload
  encoding is wrong, not the rider.

Do not "fix" the serialised control-point write queue because someone reports lag.
It is required by spec (a write during an in-progress procedure is rejected at the
ATT layer) and it costs ~130 ms. Measure first — on a Kickr Core the lag was the
trainer's 1.5 s ERG ramp, which is physical.

Protocol facts, and the parsing traps that are counter-intuitive, are in
[RESEARCH.md](RESEARCH.md) §1, §9 and §11. Read those before changing a parser.
