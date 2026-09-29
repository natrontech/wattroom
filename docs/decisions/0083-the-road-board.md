# 0083 — The road board: opt-in, unnamed, library climbs only

- Status: accepted; settles [#3319](https://github.com/natrontech/wattroom/issues/3319)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §2's Competition row — "No public leaderboards"; marked there
- Keeps: [0036](0036-what-a-room-shows-about-its-members.md) (nothing ordered without opting in), [0063](0063-a-route-keeps-its-place-with-care.md) (zones and ends stay private), [0074](0074-a-time-is-yours-when-your-watts-moved-your-dot.md) (`board_ok`)
- Beside: [0082](0082-a-climb-belongs-to-the-map.md) (stretches and efforts), [0068](0068-your-own-ghost.md) (a board line as a ghost), [0076](0076-shared-roads-not-an-open-world.md) (no strangers outside open rides)
- Decided by Jan, 2026-09-28: shared roads, option C — including "an opt-in, unnamed board on library climbs"

## Context

On 2026-09-27 Jan asked for "an opt-in board for that road". WATTROOM.md says
there are no public leaderboards, so a board is a divergence, and it has to be
one that holds the privacy promise.

Zwift's boards work because a live crowd fills them. At WattRoom's size only a
slow board fills: at the alpha size, a library climb gathers about 39–120
efforts in 90 days (RESEARCH §20). Names on a board would be public user
content with nobody to moderate them, and even an unnamed board needs a remedy
for a fabricated time that does not wait for anything else to ship.

## Decision

### What is on it

- **Library climbs only** (#3149), never a climb found from a rider's own
  route.
- **Opt-in per rider, off by default**: "My times may appear, unnamed, on
  library climb boards." The same sentence says that a crewmate who races your
  line can recognise your entry.
- **An entry** is a time, a Category and the ISO week — **no name, crew,
  watts, W/kg or weight**, and **no stable pseudonym**, so one rider cannot be
  followed across boards.
- **The top 10** per Category and stretch, over a rolling 90 days, each
  rider's best only. Only `board_ok` efforts from rides the hub streamed live,
  and never an effort whose segment lies within 1,000 m of its rider's zones or
  ends (checked when the board is read).

### Nothing about an entry outlives it

- Each entry carries an **opaque token valid 7 days**: an HMAC of the effort id
  and the ISO week. It is all that "Race one of them" and "Flag this time"
  send. The server resolves it, and answers 404 once the effort is deleted or
  its rider opted out.
- **No line bytes are ever kept on a device.** A board line raced as a ghost
  (ADR-0068) is fetched through the token each time.

### The remedy ships with the board

"Flag this time" lands in the operator's **private queue**, and an operator
command **clears that effort's `board_ok`**. It ships with the board, not with
the report feature.

### Names wait

Named entries are deferred until block (#3202) and report (#3310) have existed
for a season. Report arrives with open rides (ADR-0076); without it, names
never come.

## Consequences

- A rider can race a real time on a real climb without anyone learning who set
  it, and can take their times off the board by switching the opt-in off.
- A board is slow to fill, and says so by being short; that is the honest
  shape at this size.
- WATTROOM.md's "No public leaderboards" is marked: there is one board, on
  library climbs, of unnamed times that riders chose to put there.
- Implementation: [#3149](https://github.com/natrontech/wattroom/issues/3149)
  (the library), [#3123](https://github.com/natrontech/wattroom/issues/3123)
  (the road stats' numbers), [#3248](https://github.com/natrontech/wattroom/issues/3248)
  (`board_ok`).
