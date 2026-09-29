# 0081 — The world is keyed by place, never by the route

- Status: accepted; settles [#3250](https://github.com/natrontech/wattroom/issues/3250)
- Date: 2026-09-29
- Amends: [0063](0063-a-route-keeps-its-place-with-care.md) (the world's per-route salt ends), [0070](0070-our-own-copy-of-openstreetmap.md) (the geo pack is what a world is built from)
- Beside: [0066](0066-the-world-is-the-ride-view.md) (which already defers to this for what a world is a function of), [0082](0082-a-climb-belongs-to-the-map.md) (strokes), [0078](0078-real-ground-painted-light.md) (real ground)
- Decided by Jan, 2026-09-28: shared roads, option C — the same road is the same world whichever route reaches it; ghosts and crew lines on climbs from any route; an opt-in, unnamed board; strangers live only on scheduled open rides

## Context

Until now every ride built its own world from its own GPX: the route's name,
length and start seeded every random choice. On 2026-09-27 Jan doubted an open
world for exactly that reason. The first part of his answer the next day was
**same road, same world**.

A place lab rebuilt one reference climb three ways: A, the loop; B, its climb
as a file of its own; C, B ridden down.

- **Keyed by the route**, as today: 2 of about 3,000 objects match between A
  and B, the ground differs by up to 282 m 1 km off the road, and the pass gets
  three invented names.
- **Keyed by place**: the ground agrees to 0.00 m at the road and at 50, 200
  and 1,000 m; 7,086 of 7,086 objects match within 1 cm; names come from OSM;
  the frames are identical. A 3 m GPS re-recording builds the same world.

## Decision

### Every choice is a function of the place

- Outside private regions, **every random choice is a function of a place
  key** — a stroke and a slot along it (ADR-0082), or a lattice cell — and
  never of the route's name, length, start, direction, centroid, bounding box
  or riding time.
- **The ground is the place's height model** (noise only where none exists),
  shaped by every road, not only the one ridden. The route decides **coverage
  and the ridden line**, never content.
- **Signs stand for their own traffic. Hairpins count from the top. Names are
  OSM's**; a generated one is seeded by its 5 km tile.
- **The world changes only with its data snapshot**, for everyone at once, and
  a session pins its snapshot (#3241). A world is a function of the place and
  its data snapshot, as ADR-0066 already defers to this ADR to say.

### Privacy

- Outside private regions, the world is the real place.
- A crew sees it only under #3096's conditions, in a corridor that stops at
  the anchor (#3240), with absolute heights as ADR-0063 allows once the crew
  holds the span's coordinates. Where the owner declined, the session rides the
  road-frame world.
- The world's tiles are cut per audience and cached per tile, and the fixed
  random offset of every privacy zone stays load-bearing (ADR-0063).

### What holds under every answer

These were decided to hold whatever shared roads became, and are recorded here
as such:

- **Private regions** — a route's hidden ends, each privacy zone — are keyed by
  their own owner-only secret in local cells, and **no map data is read there**
  (#3224).
- Until this ADR is on `main`, each road's world is keyed by its per-route
  secret in the road's own frame (#3225).
- **Set-piece rhythm** is per metre at the reference rider's uphill pace,
  because M12's generator is one code path. #3221 spaces each kind by the
  faster direction's speed, so a descent meets objects more often — 11.4 s mean
  gap against 34.8 s climbing, in the lab — but never the same kind within
  45 s.

### What it costs

From the lab:

- builds are 1.8–2.1× slower (a streamed 4 km world in 0.37–0.40 s);
- descents are 3.4× denser;
- side roads and junctions become content (+37 % pieces);
- a 0.71 m junction artifact remains until junctions get a patch;
- whole strokes are built per route until slots are chunk-local.

### Not decided here

Riders in one channel on different routes meeting where they share a stroke.
#3117 keeps "the same road" as the same route.

## Consequences

- Two riders on the same pass see the same pass: the same hairpins, the same
  names, the same trees, whichever file they rode it from. That is what makes a ghost from another route, or a crewmate's line,
  mean anything.
- The world is a little slower to build and busier on descents, and those are
  the costs of it being real.
- `$lib/world/world.ts`'s header, "A world is a pure function of the Route",
  is superseded; the world work rewrites it.
- [ADR-0078](0078-real-ground-painted-light.md) builds real ground on this
  key.
- Implementation: [#3075](https://github.com/natrontech/wattroom/issues/3075),
  [#3077](https://github.com/natrontech/wattroom/issues/3077),
  [#3224](https://github.com/natrontech/wattroom/issues/3224),
  [#3225](https://github.com/natrontech/wattroom/issues/3225),
  [#3241](https://github.com/natrontech/wattroom/issues/3241).
