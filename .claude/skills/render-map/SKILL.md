---
name: render-map
description: Regenerate the Wattalp map picture (web/src/lib/world/wattalp-map.png and wattalp-map.json) after the designed map changes. Use when designs.ts (MAP_BOUNDS, MAP_NAME, a loop, spur, lake, river, stream, pass or village name), the land generator, or the --world-px-* colours in app.css change, or when map-render.golden.test.ts fails.
---

# Render the Wattalp map

The route lab's Map view shows the designed map as one static picture with the
live parts (the ridden loop, the rider's dot) drawn over it. The picture is
generated, not drawn by hand, and committed. Regenerate it whenever the map moves.

## What writes what

- Generator: `web/src/lib/world/map-render.ts` (land raster, roads, label placement).
  Water names it adds itself (`WATER_NAMES`); designs.ts names none.
- Driver: `web/src/lib/world/map-render.golden.test.ts`. Builds the Col de Berne
  loop's world (its other roads are every road on the map), then writes:
  - `web/src/lib/world/wattalp-map.png`: MAP_BOUNDS at `MAP_MPP` (10 m) a pixel,
    256-colour PNG, a few hundred KB. Terrain, hillshade, snow, rock, water, vignette.
  - `web/src/lib/world/wattalp-map.json`: road paths (loops, spurs, bridges,
    galleries) and labels (villages, passes with height, water) in the world's
    frame (x east, z = −north). In `.prettierignore`: never reformat it.
- Reader: `web/src/lib/world/MapOverview.svelte`. It uses the picture for any
  route whose `scene` is in the JSON's `loops`, else falls back to the live SVG.

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

1. Read the PNG itself (the Read tool shows images): land colours like the 3D
   Diorama look (meadow green, forest teal, violet rock, snow above 2,050 m), relief
   readable, lakes, river and streams blue with a darker shore.
2. Open the lab (dev server on :5174, never restart it):
   `http://localhost:5174/dev/route?shape=berne&view=map`, then `shape=urnsee`,
   `shape=aare`. Headless screenshot from the scratchpad helper, e.g.
   `Q="&view=map" nice -n 15 node shot.cjs <tag> shape:berne 1 2000:steady`.
3. Look for:
   - every road, spur, river and stream that leaves the rectangle runs to the
     picture's edge; nothing stops short in the open (a farm lane that truly ends
     inside may end round);
   - the ridden loop (peach) sits exactly on its white road: the frame is right;
   - no two names overlap, no name sits under the cartouche, north arrow or
     scale bar, and names do not cover roads where there was room beside them;
   - pass markers carry a sensible height; the dot (magenta) is on the road.
4. `&view=flat` uses the same world colours behind the Skyline.

## Finish

Run `pnpm exec prettier --write` on any .ts/.svelte you touched (not the JSON) and
`pnpm exec svelte-check --tsconfig ./tsconfig.json`. Commit the PNG and the JSON
together with the designs.ts change that moved them; if the picture's size or
metres per pixel changed, update the `… its picture` row in docs/spec/world.md.
