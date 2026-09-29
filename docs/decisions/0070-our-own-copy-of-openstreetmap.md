# 0070 — Our own copy of OpenStreetMap

- Status: accepted; settles [#3120](https://github.com/natrontech/wattroom/issues/3120)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §1 — "no … maps"; marked there
- Keeps: WATTROOM.md §2's Stream storage row — plain Postgres, no extension, so no PostGIS
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (what a road is), [0063](0063-a-route-keeps-its-place-with-care.md) (the corridor and the zones), [0081](0081-the-world-is-keyed-by-place.md) (the world keyed by place)
- Canon: the ODbL 1.0; the privacy page's "your ride data reaches no third-party host"

## Context

A road needs a map around it: villages, forest, water, the names of passes.
The easy answers all send a rider's whereabouts to somebody else. A hosted tile
service sees every tile a browser asks for, which is the route drawn in
requests. `tile.openstreetmap.org` is a volunteer service whose usage policy
is not there for an app to lean on. Overpass is free and public, and 4 of 7
requests to it failed on 2026-09-26.

PostGIS would answer the server's spatial questions, and WATTROOM.md chose
plain Postgres with no extension.

## Decision

### One file, built weekly, served by us

- A **weekly build** turns the Geofabrik extract into one self-hosted
  `ride.pmtiles`, the **geo pack**, with its glyphs and sprite. The extract is
  **the Alps** from the start (about 2.2 GB, decided by Jan on 2026-09-26), and
  the VM's storage and the build are sized for it.
- The geo pack is both the **basemap** and the **server's spatial index**. It
  is read with go-pmtiles (BSD-3), so the server needs no PostGIS.
- The **stroke index** (the road strokes of ADR-0082) is built at geo-build
  time and reads no route.
- It is served from **our own origin**: the CSP does not change.
- **No browser request goes to a map or weather company.**
  `tile.openstreetmap.org` is never a dependency.

### Overpass is a quantized fallback, and it is disclosed

When the geo pack cannot answer, the server may ask Overpass, and only by
**z12 tile id**, never a coordinate or a route. A z12 tile is coarse, but it
still says roughly where a route runs, so it is location data and not exempt:
the privacy page names the fallback when it ships
([#3131](https://github.com/natrontech/wattroom/issues/3131)), as it names
weather ([#3192](https://github.com/natrontech/wattroom/issues/3192)). No
browser ever talks to Overpass.

### The licences

- **ODbL.** A route's **corridor** and `road_segments` are derivative
  databases, licensed ODbL. The method that produces them is offered through
  the AGPL source (ODbL §4.6). Credit is legible wherever the data shows.
- **The stored track is never snapped.** The rider's own track is kept as they
  rode it; the ride and the world follow the matched road wherever the track
  matched (#3241). That keeps the rider's data theirs and out of the
  derivative database.
- swisstopo is credited **"© swisstopo"**. Copernicus GLO-30 carries its fixed
  attribution notice, verbatim. ESA WorldCover is **CC BY 4.0**.

## Consequences

- A map company never sees a rider: every tile a browser draws comes from
  wattroom.ch.
- The operator runs a weekly build and stores a few GB more, and the map is
  up to a week behind OpenStreetMap.
- Anything that needs a spatial answer asks the geo pack first. A feature that
  would need PostGIS is an amendment to WATTROOM.md's storage row, not a
  migration.
- WATTROOM.md §1's "no maps" is marked; roads were marked by ADR-0062.
- [ADR-0078](0078-real-ground-painted-light.md) (real ground) may amend what
  the pack carries. The one-canton pilot in
  [#3124](https://github.com/natrontech/wattroom/issues/3124) is its look
  pack, not this geo pack.
- Implementation: [#3125](https://github.com/natrontech/wattroom/issues/3125),
  [#3124](https://github.com/natrontech/wattroom/issues/3124),
  [#3131](https://github.com/natrontech/wattroom/issues/3131).

## Amendment, 2026-09-29 (#3237): the ride follows the matched road

[ADR-0082](0082-a-climb-belongs-to-the-map.md) builds the map's roads into
**strokes** at geo-build time, reading no route. Over a span matched to a
climb, the road served to the ride is **the map's line and the climb's frozen
profile**, so identical watts give an identical time whichever file brought
the rider. The stored track is still never snapped.
