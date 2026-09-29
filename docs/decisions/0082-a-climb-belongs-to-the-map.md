# 0082 — A climb belongs to the map — roads are strokes

- Status: accepted; settles [#3237](https://github.com/natrontech/wattroom/issues/3237)
- Date: 2026-09-29
- Amends: [0070](0070-our-own-copy-of-openstreetmap.md) — the ride follows the matched road
- Keeps: [0063](0063-a-route-keeps-its-place-with-care.md) (derived location data), [0074](0074-a-time-is-yours-when-your-watts-moved-your-dot.md) (who sets a time, and `board_ok`), [0036](0036-what-a-room-shows-about-its-members.md) (never ranked by default); WATTROOM.md's "never raw watts"
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (what a climb is by its numbers), [0068](0068-your-own-ghost.md) (ghosts), [0083](0083-the-road-board.md) (the road board)
- Canon: AGENTS.md — no Strava data in any model context; Jan, 2026-09-27: "same road, same world", "meet across time"

## Context

What riders can share is the road itself. Two riders who climbed the same pass
from two different files rode the same climb, and should meet on it — as
ghosts, as times — whichever file brought them.

The first plan (#3137) promised "one climb, whichever file you rode it from"
but keyed a climb on its top node plus the way ids of its last 2 km. Two files
joining a pass at different points got two keys and two physics. And way ids
are not stable: OpenStreetMap keeps a split way's id on one half only.
Strokes built from geometry kept 535 of 535 keys when a lab split all 658
multi-node ways.

Strava's segments are drawn by users and matched by 20 m tiles (US9208175B2,
active to 2031-03-31). WattRoom has the road graph (#3127), and needs neither.

## Decision

### Roads are strokes

- A **stroke** is a road built from road-class ways (secondary down to
  residential): split at junctions, and re-joined through two-way joins,
  pairing the ways at a junction by the best alignment within 45° — measured
  15 m along the road, through joins, with the same `ref` or name first.
- A stroke runs in a canonical direction, from the lexicographically smaller
  end, and is keyed by both ends and its rounded length.
- Strokes are built at geo-build time (ADR-0070) and read **no route and no
  user table**.

### A climb belongs to the map

- A **climb** is a directed chain of stroke spans from a foot to a summit,
  usually one stroke, with a canonical polyline and a profile frozen per
  version from the height model (#3129, #3130).
- It is found once per road by walking down from the summit — a pass or
  saddle within 150 m of the top, else the highest point — by the same `ref`,
  then name, then higher class, then the smaller heading change, stopping
  where the climb rule ends (ADR-0062, #3047) or at 40 km. Creating one reads
  the map and the summit, **never a route's coordinates**.
- **v1 segments are climbs only.** On a flat, absolute watts and the reference
  CdA decide the time, which would rank raw watts.
- A climb has **two stretches**: the whole climb, and its top half by map
  distance.

### The matched road is what everyone rides

Over a matched span, the served road is **the map's line and the climb's
frozen profile** (#3241), so identical watts give an identical time whichever
file brought the rider. This amends ADR-0070: the stored track is never
snapped; the ride follows the matched road.

### An effort stays private where the rider is

- An **effort** carries no route id, no coordinate and no metre outside its
  stretch.
- Visibility is decided twice:
  - at **write** time, an effort within 1,000 m of the ride's own ends is
    `near_private_end` and owner-only for good — the ends cannot be checked
    later without the route;
  - at **read** time, an effort within 1,000 m of any zone is owner-only, so a
    zone drawn later hides old lines at once.
- ADR-0063's derived-data rule applies: no effort on a segment through the
  owner's zone disc, and adding a zone deletes those efforts in the same
  transaction. The ride keeps its climbs table (#3140) and its whole-route
  ghost (#3033).
- **Strava-origin efforts stay owner-only.** Only WattRoom-recorded rides set
  road times; imported files and open rides never do (ADR-0074).

### When the map changes

A climb is **re-resolved**, or **retired with a successor**. Profiles are
frozen per version, so a time is always against the profile it was ridden on.

### What the table is

`road_segments` is an ODbL derivative database (ADR-0070) with **no personal
data**. There is **no list endpoint and no heatmap**: a climb is found from a
ride or a road, never browsed as a map of where riders go.

The numbers are in docs/SPEC.md's "Road segments and ghosts" section.

## Consequences

- One climb has one key, one profile and one set of times, however many files
  reach it and wherever they join it.
- A split or re-tagged way in OpenStreetMap does not orphan a climb.
- A human records a patent check against US9208175B2 before efforts ship to
  riders.
- This lands before the `road_segments` migration.
- Implementation: [#3137](https://github.com/natrontech/wattroom/issues/3137),
  [#3127](https://github.com/natrontech/wattroom/issues/3127),
  [#3139](https://github.com/natrontech/wattroom/issues/3139),
  [#3241](https://github.com/natrontech/wattroom/issues/3241).
