# 0071 — The bike computer pages slot 3

- Status: accepted; settles [#3063](https://github.com/natrontech/wattroom/issues/3063)
- Date: 2026-09-29
- Amends: [0046](0046-one-riding-surface.md) — slot 3 may page; the slots themselves still may not
- Argued against: [0020](0020-the-app-takes-discords-shape.md) — "switchable layouts retire"; a page of numbers is not a layout
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (a road and its climbs), [0084](0084-wattroom-shifts.md) (Harder and Easier)
- Decided by Jan, 2026-09-26: fixed data pages, no field picking

## Context

ADR-0046 gave slot 3 the rider's own numbers: rpm, bpm, W/kg, bias. A road
adds more that a rider wants on the same glance: the climb they are on, the
distance to its top, the map. Slot 3 cannot hold all of it at a size read from
a saddle.

A bike computer answers this with pages, and its failure is well known: a
rider pages away from the target and rides the interval blind. TrainerRoad
tells its users to keep the workout page up for exactly that reason. ADR-0020
retired switchable layouts because a mode you have to remember you are in is
worse than a place you can see.

## Decision

### Slot 3 pages; nothing else does

- **Slot 3 may page.** Slots 1, 2 and 4 never do, and the slots themselves never
  move. That is why this is not ADR-0020's switchable layout: the screen keeps
  its shape, and one panel shows one of a few fixed sets of numbers.
- **The pages**, a closed set:
  - **RIDE**, the default;
  - **CLIMB**, which opens by itself from RIDE when a climb begins;
  - **POWER**;
  - **MAP**, on a road only;
  - **RACE**, later.
- **No field picking** (the 95 % rule). Each page is what it is.
- **The page resets on every ride.** A rider never starts an interval on the
  page they left last week.

### How a rider turns a page

- **← and →**, or a **tap on the panel**, turn the page.
- **PgUp and PgDn are Harder and Easier** (bias, and gears under ADR-0084),
  never pages. The shift keys (`.` `,` `+` `-` `=`) and **Space**
  (push-to-talk) never turn a page either.
- A key turns a page only when no input has focus, the event was not
  `defaultPrevented` and the rider is not typing. It never takes the arrows
  from the pane divider or from the interval graph's edit keys, and soundboard
  pads bind only printable characters.

### Legible from the saddle

At the design distance — a desk at 0.8 m from a 14-inch laptop, a TV at 3 m
from a 55-inch set:

- primary numbers subtend at least **45 arcmin**;
- secondary numbers at least **22 arcmin**;
- any word read mid-ride at least **16 arcmin** (ANSI/HFES 100).

Panels are at least **85 % opaque**, and a unit is at most half the size of
its number. Distance always reads **"x of y"**.

**The big watts figure is a 3 s average.** Scoring is unchanged: it still
reads every second.

The sizes are in docs/SPEC.md's "The bike computer" section.

## Consequences

- A road's numbers fit on the riding surface without shrinking the ones a
  workout needs, and the default page is always the workout's.
- Every page is designed once, for every rider. A rider who wants a field we
  did not put there tells us, and the page changes for everyone.
- A keyboard shortcut added anywhere on the riding surface checks this ADR's
  key list first.
- Implementation: the computer
  ([#3088](https://github.com/natrontech/wattroom/issues/3088)), the keymap
  ([#3216](https://github.com/natrontech/wattroom/issues/3216)), the sizes
  ([#3067](https://github.com/natrontech/wattroom/issues/3067)). Its page table
  in code is `computer-pages.ts` (SPEC glossary).
