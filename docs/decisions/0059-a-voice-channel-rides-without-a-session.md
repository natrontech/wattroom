# ADR-0059: A voice channel rides without a session

- Status: accepted; settles [#2674](https://github.com/natrontech/wattroom/issues/2674)
- Date: 2026-09-24
- Amends: WATTROOM.md's Privacy row — live numbers reach the voice channel outside a session too
- Extends: [ADR-0058](0058-the-room-dissolves-into-the-crew.md) — a session runs in a voice channel; this says who is in it
- Beside: [ADR-0046](0046-one-riding-surface.md) — the free ride is that surface with no workout, not a fourth one
- Leaves open: [#2329](https://github.com/natrontech/wattroom/issues/2329) — a personal workout inside a session

## Context

ADR-0058 made WattRoom a place people hang out in, mostly a voice channel with
the jukebox on. Riding in one still meant one of two things: a workout on
`/ride`, alone, or a session that everyone in the channel was in.

Neither fits the evening Jan described: spin a bit, set the watts yourself,
chat, and have it land on Strava. And the second one was worse than it looked. A
session starting in the channel took over **every** trainer paired there,
whatever page its rider was on. The rider spinning easy was put on the
coach's intervals, ranked on the podium and saved a session ride they never
chose to ride.

## Decision

### A free ride

A voice channel can be ridden with no session: a **free ride**. It starts
from **Free ride** beside Start a session and opens the channel's riding
surface (`/crew/{id}/v/{channel}/training`) with no workout. The rider stays in
the call.

- **One control, two modes**, switched by one toggle: **watts ±** (ERG holds
  the number) or **grade ±** (slope, where gears and cadence decide the
  watts). The step sizes, bounds and starting values are in docs/SPEC.md.
- **It saves like any ride:** to history and, when the rider has connected
  Strava, to Strava. Its workout is the empty, unscored one a game mode
  already saves as, named "Free ride". There is no second ride shape.

### Its numbers reach the voice channel

A free rider's live watts show on their tile in the voice channel, as they
would in a session there. The audience is the one a session in that channel
already has, which is the people in the call. Nobody outside the call sees
them, and nothing is kept beyond the rider's own saved ride. The hub already
sent these samples to the channel; only the tile hid them.

This relaxes WATTROOM.md's "only inside the session, only while it runs". The
row gets a dated divergence rather than a rewrite.

### A session drives only the riders who joined it

Joining a session is explicit, and the hub holds the list. The session's
starter is in. **Join the ride** and opening the session's page put a
rider in, and **Leave the ride** takes them out. A new session starts with an
empty list.

Everyone else in the channel is a **spectator** of the session:

- their trainer is not driven, so a free rider keeps free-riding;
- nothing of theirs counts: not the ride record, the saved ride, the sprint,
  a game mode, execution, the podium, the recap's "rode" or its XP.

"Pedalling decides" was the other option, and it fails on exactly this case:
a free rider is pedalling, so the session would still take their trainer.

## Consequences

- #2329's "just spin easy while the others do intervals" is answered beside
  the session rather than inside it. A personal workout inside a session is
  still #2329's.
- A rider who wants to ride a running session has to join it. The link they
  already had, Join the ride, is now what does it.
- Implementation: [#2675](https://github.com/natrontech/wattroom/issues/2675)
  (joining) and [#2676](https://github.com/natrontech/wattroom/issues/2676)
  (the free ride).

## Amendment, 2026-09-25 (#2824): the audience is the channel, and heart rate is in it

"The people in the call" was narrower than what ships. The hub sends every
rider's sample to every screen that has the voice channel open, whether that
screen has joined the call or not. That was already true of a session's
numbers, and WATTROOM.md's 2026-09-22 divergence says so: "whoever is in the
voice channel it runs in". The audience of a free ride is therefore **whoever
has the voice channel open while the rider rides there**, and nobody else.

**Heart rate travels with the watts**, as it does in a session, until the
rider stops sharing it. The control on the riding surface that ADR-0008
requires is back since #2804, and it covers the free ride and the Lounge.

The places a rider reads before riding with people all say this in one shared
sentence (`$lib/privacy-copy`): the crew's door, Settings › Your data, and the
privacy policy.
