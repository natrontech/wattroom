# 0078 — Real ground, painted light

- Status: accepted; settles [#3283](https://github.com/natrontech/wattroom/issues/3283)
- Date: 2026-09-29
- Amends: [0063](0063-a-route-keeps-its-place-with-care.md) (a crew's real ground), [0066](0066-the-world-is-the-ride-view.md) (the quality ladder), [0070](0070-our-own-copy-of-openstreetmap.md) (the look pack beside the geo pack), [0072](0072-light-in-the-world.md) (a tone curve for world materials)
- Builds on: [0081](0081-the-world-is-keyed-by-place.md) (the world keyed by place), [0079](0079-motion-announces-the-camera-stays-still.md) (the World control)
- Decided on 2026-09-29, when Jan took the recorded recommendation (option A): Switzerland and abroad, the one-canton pilot first, and a 50 GB ceiling for Switzerland as a default. Switching it on for wattroom.ch is a human's job: [#3346](https://github.com/natrontech/wattroom/issues/3346)

## Context

Past ±1 km of the road, the planned world was generated from the road profile:
convincing, and not the place. Switzerland publishes its ground, its trees and
its imagery openly, and a read-only realism lab rendered a reference climb
(the maintainer's, kept out of the repo) in three tiers on three@0.186.1:

- on an M2 Pro at 1280×720 all three tiers hold 30 fps, at GPU times of
  1.95 / 2.5 / 4.15 ms;
- tier 2 carries 0.49–0.58 M triangles and 109 MB of textures; tier 3 carries
  0.84–0.92 M and 170 MB;
- the slow rig is unmeasured.

The lab's bake was shaped by the route: crowns kept within 450 m of the ridden
stretch, and the client burning in only the ridden road. That would let a tile
request trace a private route, and ADR-0081 keys the world by place.

## Decision

### Stylised real

- **In Switzerland**: real heights — swissALTI3D 2 m averaged to 4 m, and
  swissALTIRegio 80 m out to ±60 km with the earth's curvature; trees from the
  canopy model (swissSURFACE3D minus swissALTI3D); SWISSIMAGE graded from
  summer midday to blue hour (ADR-0072); a single-scattering sky on the high
  tier.
- **Abroad**: WorldCover and Copernicus GLO-30. GLO-30 is a surface model,
  buildings and canopy included, so under a road the height comes from the
  road's own profile. FABDEM, its bare-earth version, is CC BY-NC-SA and
  excluded.
- The generator stays outside the pack's coverage and in privacy zones.

### The look pack is baked by place

- It is **baked offline** from STAC and COG range reads, under the FSDI terms:
  bulk download, **never per-ride WMTS**.
- **Its area is route-independent** — a fixed national grid — and no import
  ever triggers a bake, so no tile request to data.geo.admin.ch can trace a
  private route.
- **Every product is route-independent too**: crowns over the whole area, the
  whole road network burned in at bake time, near imagery kept by distance to
  the network, panorama stations on a global 2 km grid
  ([#3284](https://github.com/natrontech/wattroom/issues/3284)).
- It has a **size ceiling**, measured on a one-canton pilot first. If the
  pilot extrapolates over the ceiling, the 0.5 m imagery layer gives way to
  2 m.

### Tiles

- **Place tiles** (#3240), cut per audience and cached per tile — never
  route-local chunks — so two routes over one stretch receive the same bytes.
- Heights ship as **lossless Terrarium WebP**. The CSP carries no
  `wasm-unsafe-eval`, so there is no LERC.
- **Privacy zones render generated for every viewer, the owner included.**
- **A crew sees the real ground** between the km-0 anchors, under #3096's
  conditions (members of a session or plan that carries the route; a listed
  crew's owner confirms once per route), in the corridor #3240 clamps to stop
  at the anchor, and with absolute heights — which ADR-0063 already allows once
  the crew holds the span's coordinates (its round-4 line). This settles
  ADR-0063's "coordinates later".

### The quality ladder

- Three rungs, **L1–L3** ([#3295](https://github.com/natrontech/wattroom/issues/3295)).
  Their budgets start as SPEC defaults from the lab's fast-rig numbers, and
  M20's measurements, the slow rig's included, rewrite them.
- **The World control caps the ladder** (ADR-0079): Full takes the measured
  rung, Light caps at L1, Flat skips real ground. Reduced motion opens on Flat
  with a one-tap steady camera, and there is no power-saving switch.

### Painted light

- **One hue-preserving tone curve** (`NeutralToneMapping`) for world
  materials. The rider's own dot, the zone ring and every watt accent set
  `toneMapped: false`, so ADR-0005's tokens never drift. This amends
  ADR-0072's `NoToneMapping`; [#3291](https://github.com/natrontech/wattroom/issues/3291)
  builds it.
- **The sky's hue is art-directed**, not simulated, and says so: the light is
  painted to ADR-0072's blue hour.

### Licences and credits

- **Excluded**: EOX Sentinel-2 cloudless 2018+ (CC BY-NC-SA), FABDEM (CC
  BY-NC-SA), Google, Mapbox.
- **Credits**: swisstopo, plus swissALTIRegio's sources — TINITALY, DGM
  Österreich, Bayern DGM1, LGL Baden-Württemberg and RGE ALTI — and
  OpenStreetMap under the ODbL.

The numbers are in docs/SPEC.md's "Real ground" section.

## Consequences

- A rider on a Swiss road sees that road's real mountains and trees, and the
  same ones every other rider on it sees.
- Nothing about a private route reaches swisstopo, a tile cache or another
  crew: the pack does not know routes exist.
- Until the pack is on a host, place tiles carry no real ground and rides keep
  the generated world, so all of M20 can merge before anyone commits disk.
  Switching it on — the slow-rig run, the national bake, the host's disk and
  the yearly rebake — is [#3346](https://github.com/natrontech/wattroom/issues/3346).
