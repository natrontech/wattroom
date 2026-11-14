---
name: render-map
description: Regenerate a designed land's map picture (web/src/lib/world/<land>-map.png and <land>-map.json: Wattalp's wattalp-map, the Valley's rahmental-map) after its design changes. Use when designs.ts (LANDS, a loop, spur, lane, lake, river, stream, cover, pass or village name), the land generator, or the --world-px-* colours in app.css change, or when map-render.golden.test.ts fails.
---

# Render a land's map

A designed land with a map (designs.ts `LANDS`: Wattalp, and Rahmental, the
Valley loop's land) is shown in the route lab's Map view and a ride's Map view
on any of its loops as one static picture, with the live parts (the ridden
loop, the names along it, the rider's dot) drawn over it (LandMap.svelte). The
picture is generated, not drawn by hand, and committed. Regenerate it whenever
the land moves.

## What writes what

- The land: `LANDS` in `web/src/lib/world/designs.ts`: its `id` (the files'
  stem), `name`, `bounds` (map metres east and north), its `loops`, the loop
  whose world draws it (`drawnFrom`: its other roads are every road on the
  land), `mpp` (metres a pixel) and `scale` (how big its names, marks and
  scale bar are against Wattalp's: Rahmental, half Wattalp's height, is 0.5,
  so it reads alike shown as large; the scale bar is `2 × scale` km).
- Generator: `web/src/lib/world/map-render.ts` (land raster, roads, label placement).
- Driver: `web/src/lib/world/map-render.golden.test.ts`, one block per land.
  Builds the `drawnFrom` loop's world, then writes:
  - `web/src/lib/world/<land>-map.png`: the bounds at `mpp` metres a pixel
    (Wattalp 10 m, 1,410 × 1,460, about 280 KB; Rahmental 5 m, 1,600 × 1,360,
    about 190 KB), 256 colours. Drawn as a game's island map (Zwift's
    Watopia): flat areas of each cover's world colour with rounded edges, the
    relief as three steps of that colour, flat water with two bands of
    shallows (40 m and 100 m out). No contours, no rim: the page draws the frame.
  - `web/src/lib/world/<land>-map.json`: road paths (loops, spurs, gravel
    lanes, bridges, galleries, tunnels), the roundabouts' centres and labels
    (villages, passes) in the world's frame (x east, z = −north), the font
    sizes they were placed for, and `scale` where it is not 1. In
    `.prettierignore` (`*-map.json`): never reformat it.
- Readers: `web/src/lib/world/land-map.ts` loads every land's PNG and JSON by
  file name (`MAPS`, `mapOf(loop id)`, `onLandMap(road)`);
  `LandMap.svelte` draws one, through `MapOverview.svelte` (the lab: any route
  whose `scene` is one of a land's loops) and `ride/RoadMap.svelte` (a ride, by
  `onLandMap`, either way round). It names only the villages and passes within
  250 m (× scale) of the loop ridden, no heights, no water.

## A new land

Add it to `LANDS` with whole-`mpp` bounds round its loops (every road and
river leaving the rectangle should run off its edge), run the regeneration
below, and name its picture in the `… its picture` row of docs/spec/world.md.
`land-map.test.ts` checks every land has its files and every loop lies inside
its picture.

## Regenerate

```sh
cd web
UPDATE_MAP=1 nice -n 15 pnpm exec vitest run src/lib/world/map-render.golden.test.ts
# one land only:
UPDATE_MAP=1 nice -n 15 pnpm exec vitest run src/lib/world/map-render.golden.test.ts -t Rahmental
```

Takes about 10 s for Wattalp, 3 s for Rahmental. Without `UPDATE_MAP` the same
file only checks that each JSON and PNG still match the land's bounds, name,
loops, `mpp` and `scale`. A change to one land must leave the other's files
byte-identical: `git status` shows only the land you meant to move.

If a land's bounds change so that a side is not a multiple of its `mpp`, the
sanity test fails: pick bounds in whole `mpp`, or change `mpp`. Keep a PNG
under about 400 KB; raise `mpp` before shrinking the palette.

## Check it by looking

1. Read the PNG itself (the Read tool shows images): flat areas in the 3D
   Diorama's colours (meadow green, forest teal, violet rock, snow above
   2,050 m on Wattalp; fields as tan strips), the relief readable in its light
   and dark steps, lakes, rivers and streams blue with lighter shallows.
2. Open the lab (`make dev-env` prints this checkout's web port):
   `/dev/route?shape=berne&view=map`, then `shape=urnsee`, `shape=aare`,
   `shape=lac`, `shape=kette`, and `shape=valley` for Rahmental, headless. A
   ride's Map view (`/ride?road=aare&sim=1` or `road=valley`, Ride simulated,
   Start the ride, Map) shows the same map smaller.
3. Look for:
   - every road, spur, lane, river and stream that leaves the rectangle runs to
     the picture's edge; nothing stops short in the open (a farm lane that
     truly ends inside may end round);
   - the ridden loop (white, bright ahead of the dot, faint behind it) sits
     exactly on its thin dark road: the frame is right;
   - no two names overlap, no name sits under the map's name, north arrow or
     scale bar, or over the start's flag, and names do not cover roads where
     there was room beside them; the dot (magenta) is on the road;
   - a land at another scale reads like Wattalp: its name, flag, dot and
     names the same size on screen, its scale bar's last tick its true
     length (`1 km` on Rahmental).
4. `&view=flat` uses the same world colours behind the Skyline.

## Finish

Run `pnpm exec prettier --write` on any .ts/.svelte you touched (not the JSON) and
`pnpm exec svelte-check --tsconfig ./tsconfig.json`. Commit the PNG and the JSON
together with the designs.ts change that moved them; if a picture's size or
metres per pixel changed, update the `… its picture` row in docs/spec/world.md.
