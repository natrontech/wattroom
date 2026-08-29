# 0008 — Heart rate: live in-room, never in a shared artifact

- Status: accepted
- Date: 2026-08-29

## Context

[WATTROOM.md](../../WATTROOM.md) says two true things that constrain different
scopes, and the gap between them was being filled by inference:

- Line 13: presence means "everyone's live watts **and heart rate** are visible".
- Line 55: "HR is health data; act like it."

Both hold — visible live in a room is not the same as retained, aggregated or
shared — but nothing wrote that down. Two things had already been built on the
unwritten reading: the post-ride summary screen promises "it never shares your heart
rate", and #11 shipped a `bpm` readout and heart rate in the rider's own `.fit`.
[docs/SPEC.md](../SPEC.md) meanwhile defines a Sample as "watts, HR, cadence, seq"
going client → server at ~1 Hz, so HR does cross the wire.

The question is not whether HR is visible — the product needs it — but what happens
to it afterwards, and it is cheaper to decide now than to discover when room code
lands in M2.

## Decision

**Live, in-room, while riding: yes.** Heart rate rides alongside watts in the Sample
stream and renders on other riders' tiles. This is the presence feature and is what
line 13 promises.

**Server-side it is live state, not durable data.** HR lives in the hub's in-memory
room state and is dropped when the ride ends, the same as every other live metric.
It is never written to Postgres as part of room, session or leaderboard data. This
follows the architecture's existing seam rather than inventing a rule for it: the
server owns live state in memory, Postgres owns durable data.

**Durable only in the rider's own ride, never in a cross-rider artifact.** A rider's
own history and their `.fit` may carry HR — it is their training data and every head
unit stores it. Nothing that another person can see may: not medal cards, not shared
ride summaries, not room history, not leaderboards, not aggregates. The summary
screen's existing promise becomes a rule rather than a sentence someone wrote.

**No HR-derived competition.** No medal, score or ranking may be computed from heart
rate. Today's medals are already power-based (docs/SPEC.md), so this costs nothing
now — which is exactly why it is worth fixing before something cheap and tempting
gets built on it.

**No per-rider visibility toggle.** Per the 95 % rule, a rider who does not want to
share HR does not pair a strap. See the consequence below, which is where this gets
interesting.

## Consequences

- **Trainer-relayed HR can arrive without the rider ever opting in.** A strap bonded
  to the trainer from Zwift or the Wahoo app comes through the FTMS stream (#44) with
  no pairing action in WattRoom at all. So "just don't pair a strap" is not a
  sufficient answer on its own: the rider must be able to *see* that HR is being
  shared and stop it in one action. That affordance is a requirement of this ADR, not
  a nice-to-have, and it belongs wherever the room tile or pairing screen shows what
  is being transmitted. Filed as a follow-up.
- Export-all and delete-account purge cover the rider's own stored HR, unchanged —
  there is simply less of it elsewhere to purge.
- The hub keeps no HR history, so any future feature wanting HR trends (a fatigue
  view, HR-vs-power drift) has to source it from the rider's own rides rather than
  from room state. That is the intended shape, not an obstacle.
- RR intervals are parsed off real straps (#11) and currently discarded. They are
  more sensitive than bpm, not less — HRV is closer to a medical signal. Nothing may
  persist or transmit them without revisiting this ADR.
- Revisit trigger: a feature that genuinely needs cross-rider HR — a coach-facing
  view of a rider's zones, say. That is a real product idea and this ADR does not
  forbid it, it requires it to be an explicit decision with an explicit consent flow
  rather than a default.
