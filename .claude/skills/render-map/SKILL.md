---
name: render-map
description: Regenerate the Wattalp map picture (web/src/lib/world/wattalp-map.png and wattalp-map.json) after the designed map changes. Use when designs.ts (MAP_BOUNDS, MAP_NAME, a loop, spur, lake, river, stream, pass or village name), the land generator, or the --world-px-* colours in app.css change, or when map-render.golden.test.ts fails.
---

# Render the Wattalp map

The route lab's Map view and a ride's Map view on any of the map's loops show
the designed map as one static picture with the live parts (the ridden loop,
the names along it, the rider's dot) drawn over it (WattalpMap.svelte). The
picture is generated, not drawn by hand, and committed. Regenerate it whenever
the map moves.

## What writes what

- Generator: `web/src/lib/world/map-render.ts` (land raster, roads, label placement).
- Driver: `web/src/lib/world/map-render.golden.test.ts`. Builds the Col de Berne
  loop's world (its other roads are every road on the map), then writes:
  - `web/src/lib/world/wattalp-map.png`: MAP_BOUNDS at `MAP_MPP` (10 m) a pixel,
    256-colour PNG, about 100 KB. Drawn as a game's island map (Zwift's
    Watopia): flat areas of each cover's world colour with rounded edges, the
    relief as three steps of that colour, flat water with two bands of
    shallows. No contours, no rim: the page draws the frame.
  - `web/src/lib/world/wattalp-map.json`: road paths (loops, spurs, bridges,
    galleries), the roundabouts' centres and labels (villages, passes) in the
    world's frame (x east, z = −north), and the font sizes they were placed
    for. In `.prettierignore`: never reformat it.
- Readers: `web/src/lib/world/WattalpMap.svelte`, through `MapOverview.svelte`
  (the lab: any route whose `scene` is in the JSON's `loops`) and
  `ride/RoadMap.svelte` (a ride, by `wattalp.ts` onWattalp). It names only the
  villages and passes within 250 m of the loop ridden, no heights, no water.

## Regenerate

```sh
cd web
UPDATE_MAP=1 nice -n 15 pnpm exec vitest run src/lib/world/map-render.golden.test.ts
```

Takes about 10 s. Without `UPDATE_MAP` the same file only checks that the JSON and
PNG still match MAP_BOUNDS, MAP_NAME and MAP_MPP.

If MAP_BOUNDS changes so that a side is not a multiple of `MAP_MPP`, the sanity
test fails: pick bounds in whole 10 m, or change `MAP_MPP`. Keep the PNG under
about 400 KB; raise `MAP_MPP` before shrinking the palette.

## Check it by looking

1. Read the PNG itself (the Read tool shows images): flat areas in the 3D
   Diorama's colours (meadow green, forest teal, violet rock, snow above
   2,050 m), the relief readable in its light and dark steps, lakes, river and
   streams blue with lighter shallows.
2. Open the lab (`make dev-env` prints this checkout's web port):
   `/dev/route?shape=berne&view=map`, then `shape=urnsee`, `shape=aare`,
   `shape=lac`, headless. A ride's Map view (`/ride?road=aare&sim=1`, Ride
   simulated, Start the ride, Map) shows the same map smaller.
3. Look for:
   - every road, spur, river and stream that leaves the rectangle runs to the
     picture's edge; nothing stops short in the open (a farm lane that truly ends
     inside may end round);
   - the ridden loop (white, bright ahead of the dot, faint behind it) sits
     exactly on its thin dark road: the frame is right;
   - no two names overlap, no name sits under the map's name, north arrow or
     scale bar, or over the start's flag, and names do not cover roads where
     there was room beside them; the dot (magenta) is on the road.
4. `&view=flat` uses the same world colours behind the Skyline.

## Finish

Run `pnpm exec prettier --write` on any .ts/.svelte you touched (not the JSON) and
`pnpm exec svelte-check --tsconfig ./tsconfig.json`. Commit the PNG and the JSON
together with the designs.ts change that moved them; if the picture's size or
metres per pixel changed, update the `… its picture` row in docs/spec/world.md.
