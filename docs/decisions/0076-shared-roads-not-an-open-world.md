# 0076 — Shared roads, not an open world — live strangers only on open rides

- Status: accepted, with its open-ride section; settles [#3298](https://github.com/natrontech/wattroom/issues/3298)
- Date: 2026-09-29
- Diverges from: WATTROOM.md — "no content treadmill (… events)", and §2's Realtime architecture, Privacy, Competition, Fan-out, Validation and Join flow rows, for open rides; all marked there
- Answers: [0010](0010-room-first-positioning.md) decision 4, which asks for this privacy ADR; [0012](0012-friends-presence.md)'s note naming the block list (#3202)
- Beside: [0081](0081-the-world-is-keyed-by-place.md) (same road, same world), [0082](0082-a-climb-belongs-to-the-map.md) and [0083](0083-the-road-board.md) (meeting across time), [0065](0065-riding-a-road-together.md) (the bunch), [0039](0039-the-public-room-directory.md) (a listed crew's name and mark)
- Decided by Jan, 2026-09-28: shared roads, option C — shared roads plus open rides; the always-on open road parked

## Context

On 2026-09-27 Jan doubted an open world. Every ride built its own world from
its own GPX, so there was no Watopia-style shared map for strangers to fill.
The reply proposed **shared roads**:

- (a) the same road is the same world, because generation is keyed by place
  (ADR-0081);
- (b) and (c) riders meet **across time**, through ghosts on road segments:
  your best, your crew's lines and an opt-in board (ADR-0082, ADR-0083);
- (d) live strangers only where a time and a place concentrate them.

At WattRoom's size a road outside an event is empty. With 100 riders online,
another solo rider is on your 5 km of home road **0.6–9 %** of the time,
against roughly **250–1,500** others per 5 km in Zwift at its peak
(RESEARCH §20, `scripts/road-density.py`). An always-on open road would be an
empty road that looks broken.

## Decision

### Under every answer

1. **There is no shared open world and no always-on road.** Strangers never
   meet on a road outside an open ride, never in a crew's channels, never on a
   rider's own route, never on a Strava-origin route.
2. **The always-on open road is parked**, with a reopen condition measured
   without ids ([#3311](https://github.com/natrontech/wattroom/issues/3311),
   where built):
   - at least **60 solo rides a week on one library road** for **4
     consecutive weeks** (λ ≈ 2.9 at a moment, RESEARCH §20);
   - that road's open rides, if any, at a **median of at least 10 riders from
     at least 3 crews over 8 weeks**;
   - and a recurring open ride there tried first.
3. **Rejected**: a Watopia-style shared map; the always-on road now; the house
   crew as a place; named strangers; stranger text.

### Open rides

4. **An open ride is a planned session (#116) its crew opened to everyone**: a
   library road (#3149), a curated pace, a format and a time, opened by an
   owner or admin within a per-crew cap. No free text reaches a stranger beyond
   a listed crew's name and mark (ADR-0039); an unlisted crew reads "Hosted by
   a crew" with a generated mark.
5. **Formats.** The group ride (ADR-0065) in v1, because it tells a stranger
   nothing about anyone's strength. Chase the Devil and Wheelrace after the
   race core, each rider seeing only their own placing. No mass-start Category
   race until open rides reach a median of 10 riders from 3 crews for 8 weeks
   and there is a design for enforcing categories.
6. **The pen opens before the flag.** A rider joins from their crew's voice
   channel (a free ride there, ADR-0059) or alone from `/ride`.
7. **What each audience gets**:

   | Audience            | Gets                                                                                                     |
   | ------------------- | -------------------------------------------------------------------------------------------------------- |
   | a stranger          | a per-ride id, a position, a speed and a coarse kit — never a name, a number or the look hash             |
   | your channel        | a free ride there (ADR-0059); the ride's position frame is a second audience, and it carries no numbers  |
   | anyone (the card)   | a listed crew's name, mark and door, or "Hosted by a crew"; the road, format, pace and time (ADR-0039)   |
   | the calendar        | the host crew's feed shows the ride marked open; a stranger gets a single-event `.ics`                   |
   | the server          | the id map for the ride, dropped 24 h after it                                                           |

   The amendment sections that carry these into ADR-0021, ADR-0039 and
   ADR-0059 are [#3299](https://github.com/natrontech/wattroom/issues/3299)'s.

8. **Voice**: nothing crosses a crew. Leader calls are a closed set; leader
   radio is a later decision.
9. **Results**: counts, and your own placing once in race formats — never a
   list, never stored. Open rides save untimeable, never `board_ok`
   (ADR-0074).
10. **Safety**: hide, with a label-only row; a private report queue kept 30
    days, covering host cards; the id map dropped 24 h after the ride. **No age
    gate**, because no stranger's voice, name or free text (beyond a listed
    crew's name and mark) reaches a rider. The line for under-16 riders
    reopens the day any of those three would reach one.
11. **Architecture**: one open-ride room per ride, one nameless frame a second
    for all, a per-ride cap, and the same bunch and race engines a session
    drives.
12. **The house crew hosts; it does not gather.** It is an ordinary, unlisted
    crew of the operator's ride leaders, with private channels, that opens
    rides.
13. **Not now**:
    - **names by consent** — not before block (#3202) and report (#3310) have
      run for a season, the bar ADR-0083 sets for names on the board;
    - **a cross-crew wave**;
    - **invite-only crew-to-crew rides**.

    The last two reopen only through an amendment to this ADR that brings its
    own measured case, in the same id-free units as point 2.

## Consequences

- Riders meet across time everywhere — ghosts, crew lines, the board — and
  live only where a time and a road concentrate them, so a meeting is never
  an empty road that looks broken.
- A stranger on an open ride is a shape at a speed. Nothing about them, and
  nothing about you, crosses to the other.
- The operator runs rides, not a world: the house crew opens events on library
  roads, which is content on a calendar and not a treadmill of new places.
- WATTROOM.md is marked where open rides reach past a crew: events, the
  realtime architecture, privacy, competition, fan-out, validation and join
  flow. The amendment sections in other ADRs follow in
  [#3299](https://github.com/natrontech/wattroom/issues/3299).
- Implementation: [#3149](https://github.com/natrontech/wattroom/issues/3149),
  [#3311](https://github.com/natrontech/wattroom/issues/3311),
  [#3202](https://github.com/natrontech/wattroom/issues/3202).
