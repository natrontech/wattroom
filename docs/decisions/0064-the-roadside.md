# 0064 — The roadside: what a spectator may do

- Status: accepted; settles [#3043](https://github.com/natrontech/wattroom/issues/3043)
- Date: 2026-09-29
- Extends: [0059](0059-a-voice-channel-rides-without-a-session.md) — everyone in the channel who is not riding a session is its spectator; [0022](0022-room-events-are-ephemeral.md) — what happens there is not kept
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (the road a spectator stands beside), [0084](0084-wattroom-shifts.md) (gears)
- Canon: Jan, 2026-09-26 — no spectator action ever changes a rider's resistance

## Context

ADR-0059 made the people in a voice channel who are not riding its session
**spectators**: their trainers are not driven, and nothing of theirs counts.
It said what a spectator is not, and nothing about what one may do.

Ride Worlds gives them things to do. A phone propped beside the bike, a desk in
the lounge and a rider a game has put out can all ring a cowbell, hand up a
bottle, paint a climb, open a Prime or back a rider. Each of those verbs is
harmless alone. Together, and aimed at somebody, they are a way for one person
to change another person's ride: make it harder, score it, or single it out.
Jan's rule of 2026-09-26 closes the obvious door, resistance. This ADR writes
the rule down whole, before the first verb past v0 (#3022) is built.

## Decision

### The rule

**The roadside paints, sounds and informs. It never reaches a rider's ride.**

- **No spectator action writes to a trainer, ever** — not its mode, not its
  target, not its grade.
- **A spectator never picks a rider for anything that reaches their ride**:
  their trainer, their position or their score. A bottle, a backing or a cheer
  aimed at one rider is **presence only** — a sound, a line, a mark — and
  changes nothing they ride.
- **When, never who.** An effect that is equal for every rider in a bracket is
  allowed: a Prime, a devil's pace. A spectator may choose the moment; they
  never choose the person.
- **Eliminated riders count as spectators** while the game runs.

### The Prime

The Prime is a spectator's verb, and it is a **scored window and nothing
else**: the best 5 s W/kg inside the existing 15 s sprint window.

- No `sprintGrade` and no 2 × FTP flip: the trainer does what it was doing.
- A geared rider keeps their road grade (ADR-0084).
- A single-speed rider keeps ERG by the road.

It is called **Prime** so nobody mixes it up with v0's cowbell, the
`bell-ring` key, which is a sound.

### Bounds

- **Closed sets only.** Every verb, sound and mark is from a fixed list; no free
  text, no uploads.
- **Budgets.** Each verb has a per-person budget, and the roadside has a
  **sound ceiling** per rider. A refused verb answers the way errors.md says a
  deliberate tap does — what happened, and when it may be tried again.
- **Verbs freeze near riders.** Nothing a spectator placed on the road moves or
  changes while riders are close to it.
- **Weather is atmosphere only.** FTMS wind stays 0.
- **Photosensitivity.** At most one dim flash per 10 s, and none under reduced
  motion.
- **Nothing is persisted** except badge counters. The rest is as ephemeral as
  a channel event (ADR-0022).

The numbers are in docs/SPEC.md's "The roadside" section; the verbs' own
distances and budgets join it with the bunch numbers (#3094).

## Consequences

- Every roadside verb from here on is checked against one sentence — does it
  reach a rider's trainer, position or score, or does a spectator pick who? —
  and is refused if it does.
- A crowd cannot grief a rider it does not like: the only thing it can aim at
  one person is noise, and the noise has a ceiling.
- The Prime needs a second kind of sprint window that the actuation code
  ignores ([#3109](https://github.com/natrontech/wattroom/issues/3109)).
- WATTROOM.md §1 is untouched: a spectator was never ruled out, only what
  they could do was unwritten.
- v0 is [#3022](https://github.com/natrontech/wattroom/issues/3022) (the
  cowbell, a bottle, eliminated riders at the roadside).
