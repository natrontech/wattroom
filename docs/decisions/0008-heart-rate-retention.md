# 0008 — Heart rate: live in-room, never in a shared artifact

- Status: accepted
- Date: 2026-08-29
- Amended: 2026-08-29 — the retention bullet was headed in a way that read as
  forbidding what the bullet below it permits. Reworded, and the per-rider analytics
  intent made explicit rather than merely allowed.

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

**What is ephemeral is HR *as room state*.** The copy of your heart rate that other
riders can see lives in the hub's memory and is dropped when the ride ends, like
every other live metric. It is never written to Postgres as room, session or
leaderboard data, and no other rider's view of it outlives the ride.

**What is durable is the rider's own ride.** The rider's full 1 Hz sample stream —
watts, cadence, **and heart rate** — is stored server-side against their own account
and kept, exactly as [#15](https://github.com/natrontech/wattroom/issues/15) already
plans (summary columns plus a compressed 1 Hz sample blob). This is deliberate and
is the point: heart rate is what makes the interesting analysis possible, and a
rider's training history is theirs to keep. Every head unit on the market stores it.

**Analysis is per-rider.** Their own stored data, shown back to them: HR drift within
a ride, aerobic decoupling, zone distribution, fitness trend across months, power
curve. That is where the value is and it needs nobody else's data.

**Never in a cross-rider artifact.** Not medal cards, not shared ride summaries, not
room history, not leaderboards, not population aggregates. The summary screen's
existing promise becomes a rule rather than a sentence someone wrote.

**Cross-user analysis is out of scope and needs its own decision.** Comparing a
rider's HR against a population baseline, or training anything on the pooled corpus,
is a materially different posture: heart rate is special-category health data under
GDPR and sensitive personal data under the Swiss revDSG, so it would need explicit,
separate, revocable consent, and storage that can actually honour a withdrawal. Not
forbidden — it is a legitimate future product — but it does not happen as a side
effect of having the data lying around.

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
- Export-all and delete-account purge now carry real weight: the rider's own stored
  HR is the bulk of what a purge has to remove, and the 1 Hz sample blob is where it
  lives. Deleting an account has to take the blobs, not just the summary rows.
- [#25](https://github.com/natrontech/wattroom/issues/25) (ride completion stats) can
  build HR-based metrics freely, as long as every one of them is the rider's own
  number shown to that rider.
- The hub keeps no HR history, so a fatigue view or an HR-vs-power drift chart reads
  the rider's own stored rides rather than room state. That is the intended shape:
  analytics are a query over your own history, not a tap on the live stream.
- RR intervals are parsed off real straps (#11) and currently discarded. They are
  more sensitive than bpm, not less — HRV is closer to a medical signal. Nothing may
  persist or transmit them without revisiting this ADR.
- Revisit trigger: a feature that genuinely needs cross-rider HR — a coach-facing
  view of a rider's zones, say. That is a real product idea and this ADR does not
  forbid it, it requires it to be an explicit decision with an explicit consent flow
  rather than a default.
