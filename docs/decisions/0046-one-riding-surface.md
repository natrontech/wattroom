# 0046 — One riding surface: the room, the solo ride and the ramp test are the same screen

- Status: accepted
- Date: 2026-09-09
- Constrained by: [0020](0020-the-app-takes-discords-shape.md) — one frame, no switchable layouts — and `.claude/rules/ux.md`: read at three metres, at 160 bpm
- Answers: [#1531](https://github.com/natrontech/wattroom/issues/1531), and the parity half of [#1529](https://github.com/natrontech/wattroom/issues/1529) and [#1559](https://github.com/natrontech/wattroom/issues/1559)

## Context

The app has three screens a rider pedals in front of, built at three
different times by three different issues:

| | built for | file |
| --- | --- | --- |
| the room's Training place | ADR-0020's places, #383, #412 | `routes/r/[slug]/training/+page.svelte` |
| the solo ride | #126, split into four files by #1057 | `routes/ride/+page.svelte` + `lib/ride/RidingScreen.svelte` |
| the ramp test | #14, ADR-0020 moved it onto the shelf | `routes/ramp/+page.svelte` |

They already share the pieces that were obviously one thing — `Instrument`,
`IntervalGraph`, `SecondaryRow` — and diverge on everything that was not.
One rider rode all three back to back on 2026-09-09 (#1531, #1529, #1565,
#1566) and the reports read as one complaint:

> heart rate and rpm are too tiny · no countdown to the next section · no zone
> view · the whole workout solo screen looks super empty and boring
>
> looks a lot better [in the room] — maybe adapt a lot here also for solo. i
> also think solo and room rides should look and feel similar
>
> [the ramp is] super ugly and not nice to see the stats · not showing what's
> coming next · no other stats like bpm or so shown

The room's surface is the one the rider liked, and it is the one with the most
built into it. So this is not three redesigns. It is one surface, and two
screens that have to catch up to it.

The drift measured (2026-09-09, `main`):

| | room | solo | ramp |
| --- | --- | --- | --- |
| block *n* of *m*, named | yes | no — `segment.kind`, lowercase, in the subtitle | no |
| seconds left in the block | yes, display size | a `0:38` readout among four | as `+20 W in 31s` |
| **what is coming next** | `next · Endurance 135 W for 1 min` | **nothing** | a delta, never the target |
| elapsed / total | yes | remaining only | elapsed only |
| cadence / HR band of the block | yes, header, coloured | one small line | no |
| rpm · bpm · w/kg | `SecondaryRow` | its own smaller row, no w/kg | **none at all**, while recording HR |
| the zone you are in | no | no | no |
| your live execution score | `ExecutionMeter`, ≥2 riders | a readout | no |
| interval graph with your trace | yes | yes | a progress bar |
| a sprint releases the trainer to slope | yes | **no — writes ERG 0 W** (#1529) | n/a |
| ⚑ flag a problem | **no** | yes | no |
| TV | `TvMode` | `RideTv`, a second design | no |
| phone | `TrainingPhone` | no | no |

## Decision

**There is one riding surface. It has five slots, in this order, on all three
screens.** What fills a slot changes with the context; the slots and their
order do not.

```
┌───────────────────────────────────────────────────────────────┐
│ 1  WHERE YOU ARE IN THE WORK                                  │
│    block 3 of 12 · Threshold · 0:42 left · 95–105 rpm         │
│    next · Endurance 135 W for 1 min      2:18 / 4:00  [ctrl]  │
├───────────────────────────────────────────────────────────────┤
│ 2  THE FOCUS — one thing, chosen by the situation             │
│    sprint › game › shared screen › your instrument            │
├───────────────────────────────────────────────────────────────┤
│ 3  YOUR NUMBERS — rpm · bpm · w/kg · bias                     │
├───────────────────────────────────────────────────────────────┤
│ 4  THE OTHERS — crew strip · live execution      (room only)  │
├───────────────────────────────────────────────────────────────┤
│ 5  THE HORIZON — the interval graph, your trace, the cursor   │
└───────────────────────────────────────────────────────────────┘
```

**The parity rule: a feature that exists on one riding surface exists on all
three, unless it needs people.** Slot 4 is the only slot a solo screen may
drop, because there is nobody in it. Everything else — what block this is,
what is coming, your rpm and bpm, the zone, the graph, the flag, the TV — is
about one rider and a trainer, and a rider alone deserves it as much as a
rider in a room. Anything proposed for one of the three from now on is
proposed for the surface, or it is argued as a fourth exception here.

The three legitimate differences, and nothing else:

1. **The crew** (slot 4) — a roster, its live execution ranking, the cheers.
2. **What may take the focus** (slot 2) — a sprint moment, a game and a
   shared screen exist only where there are people to share them with. Solo
   and ramp fill slot 2 with the instrument, always. A *sprint block* is not
   in this list: a solo workout can carry one and it must behave the same way
   on the trainer (#1529).
3. **Who owns the timeline.** In a room the hub owns the clock, so skipping a
   block or adding a minute is the coach's, over the protocol, or it does not
   exist; solo the rider owns it outright. This is the one place the *controls*
   legitimately differ, and it is a protocol fact, not a design choice.

**The count-in is not a fourth exception** ([#1800](https://github.com/natrontech/wattroom/issues/1800),
decided by the repo owner 2026-09-10). Who owns the timeline is a difference;
*counting the timeline in* is not — a rider taps Start on the laptop beside the
bike and needs a moment to get back on it whether or not anybody else is
waiting. So every riding surface counts in before its clock moves: ten seconds
in a room because a roster is being gathered, three solo and on the ramp
because nobody is, and the same 3-2-1-go cues and one-digit screen on all three
(`lib/room/CountdownScreen.svelte`, `countdown` on `RideSoundDeps`). The clock
starting late is the point of it: the first block's target reaches the trainer
when the count-in ends, not at the tap. Specced in docs/SPEC.md's session
lifecycle.

**The count-in is not a fourth exception** ([#1800](https://github.com/natrontech/wattroom/issues/1800), decided by the repo
owner 2026-09-10). Who owns the timeline is a difference; *counting the
timeline in* is not — a rider taps Start on the laptop beside the bike and
needs a moment to get back on it whether or not anybody else is waiting. So
every riding surface counts in before its clock moves: ten seconds in a room
because a roster is being gathered, three solo and on the ramp because nobody
is, and the same 3-2-1-go cues and one-digit screen on all three
(`lib/room/CountdownScreen.svelte`, `countdown` on `RideSoundDeps`). The
clock starting late is the point of it: the first block's target reaches the
trainer when the count-in ends, not at the tap. Specced in docs/SPEC.md's
session lifecycle.

**The ramp test is a workout, not a third thing.** `buildRampTest()` already
returns a normal `Workout` on the normal engine, so `describeBlock()` gives it
the same header every other ride gets — the absolute target of the next step,
which is the number the rider is deciding whether they can hold, instead of
`+20 W`. Its only real difference is the word: it prescribes a *step*, which
`Instrument` has taken as `targetLabel` since #386.

**One header component, one numbers row, fed by the same view model.**
`describeBlock(info, segments, workout, ftp)` in `lib/room/view.ts` is pure and
already returns everything slot 1 needs. The room derived it and the other two
never called it; that, and not a missing design, is why they say less.

## Consequences

- The shared riding widgets live under `lib/room/` for historical reasons and
  are used by screens with no room. Renaming the directory is a chore, not a
  decision; it does not gate any of the work above.
- `RideTv` and `TvMode` are the same screen at 3 m with and without a roster,
  and converge the same way. Until they do, the parity rule says a solo rider
  keeps TV.
- The end-of-session card is *not* part of this surface. It has its own issue
  (#1559) and its own answer: one card that grows a roster section in a room.
- Nothing here changes what the hub sends. Every gap in the table above is a
  client that did not draw what it already had, except skip/extend in a room,
  which is a protocol question and is filed as one.

## Open

- May a rider skip a block or add a minute **in a room**, and if so is it the
  coach's control or everyone's? Filed `needs-human-input`; until it is
  answered the room simply does not offer them.
