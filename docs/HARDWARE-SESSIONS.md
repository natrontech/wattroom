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

Open <http://localhost:5173/dev/hardware>.

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

### 3. Hand it back

Post `web/.hwlog/session.jsonl` on the issue — attach it, or paste it if it is small.
Add a sentence or two on how it *felt*, especially anything that felt broken. The
file has the numbers; it cannot tell us that ERG felt sluggish or that a grade was
unrideable, and those turn out to matter.

## For the agent helping with this

The log is JSONL, one object per line, `kind` being `sample`, `event`, `control-ack`,
`gatt-dump` or `page-loaded`. Useful things to compute rather than eyeball:

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
