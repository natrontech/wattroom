# 0092 — The world draws flat: low poly in flat colour, never under a pixel per CSS pixel

- Status: accepted
- Date: 2026-10-28
- Answers: [#4256](https://github.com/natrontech/wattroom/issues/4256)
- Amends: [0066](0066-the-world-is-the-ride-view.md) (resolution is the last thing the world gives up), [0072](0072-light-in-the-world.md) (world materials are flat shaded; the light and palette stay), [0078](0078-real-ground-painted-light.md) ("Stylised real" becomes heights and land cover, with no imagery)
- Decided by Jan, mid-ride on 2026-10-28: make the art style simpler and less like the real world, so the world costs less to draw and can draw sharper.

## Context

Jan rode a solo workout in 3D on the desktop shell and found the world ugly and pixelated. The trees, the hay bales, the edges and the road lines all showed it (#4256). Three things in the code explain it:

- **The frame was scaled up.** `budget.ts` capped the world at 1.0 MP with no floor. A full desk window's canvas, about 1850 × 730 CSS px, drew at 0.86 pixels per CSS pixel, and the browser stretched it. [#4264](https://github.com/natrontech/wattroom/pull/4264) adds a floor of one.
- **The surfaces painted detail per pixel.** The ground shader adds noise to every facet ("no facet of ground is one flat colour", `styles.ts`) and lays masonry on rock faces; the road shader adds a 12 cm grain to the asphalt (`geometry.ts`). That detail sits inside the triangles, where the renderer's antialiasing does not reach, and a stretched frame turns it to grit.
- **Detail was thinner than a pixel.** The road's lines are 12 cm wide. Past about 100 m from the camera they cover less than a pixel and shimmer as the road moves.

ADR-0078's "stylised real" aimed the other way: real heights, real trees and SWISSIMAGE photo imagery graded to blue hour. In its lab the imagery was most of the cost: 109 MB of textures on tier 2 and 170 MB on tier 3.

Pixels are cheap by comparison. On an M2 Pro, an offscreen 1839 × 851 canvas cost 6.4 % GPU at the old ratio (1.0 MP) and 7.1 % at the floor (1.56 MP).

## Decision

### Flat low poly

- Every world surface is **low poly and flat shaded**, with one normal per face: the ground, the road, the dressing and the furniture. A change of shade then falls on a triangle edge, which the renderer's antialiasing smooths.
- Colour is **flat per face or per vertex**, from the world's token family (ADR-0072). Surfaces paint no detail per pixel: no noise, grain or masonry.
- **No photo textures and no image maps** on world surfaces. A texture remains only where it carries words (boards, the arch, name tags) or the sky's gradient.
- **Fewer, bigger shapes.** A prop is a handful of faces that reads at the ride camera's distance.
- **Nothing is drawn thinner than a pixel.** A road line, a fence or a branch that would be is drawn wider or fades out with distance.
- Figures and bikes are outside this decision. ADR-0073 and M12 ask them to look like athletes on real bikes.

### Blue hour stays

- ADR-0072's light holds: blue hour that darkens with the ride, peach alpenglow, light from the sky only, and only your own line glows.
- The sky is the painted gradient on every tier. ADR-0078's single-scattering sky on the high tier is dropped.

### Real ground is heights and land cover

- Real ground keeps ADR-0078's heights (swissALTI3D and swissALTIRegio in Switzerland, GLO-30 abroad) and its trees from the canopy model, drawn as low-poly trees in flat colour.
- **Land cover shows as one flat colour per class**, such as forest, meadow, rock, glacier, water and settlement: swissTLM3D's land cover in Switzerland, WorldCover abroad.
- **SWISSIMAGE leaves the look pack.** No imagery is baked, tiled or shipped. The pack's 50 GB ceiling now covers heights, crowns and land cover.

### Pixels before polygons

- The world draws **at least one pixel per CSS pixel** (SPEC "The world"). A desk window bigger than the 1.0 MP budget draws more than the budget.
- When a rig cannot afford a frame, the quality ladder ([#3295](https://github.com/natrontech/wattroom/issues/3295)) gives up geometry first: dressing density, far detail, the ground's reach. Resolution never goes under the floor. Past the last rung the Skyline takes over, as ADR-0066 says.

## Consequences

- The world costs less to draw and to ship: no imagery to bake or serve, no noise in the ground's shader, fewer triangles per prop.
- A rider knows a real road by its shape, its heights and its land cover, not by a photo of it.
- `world-realism-tier3` and `world-bluehour-hairpin` stay the bar for framing, camera, sky and palette. They stop being the bar for surface detail (TARGETS.md D4).
- The dressing is rebuilt in this look under #4256, and `make perf-scenes` holds the tier budgets at the floor.
- SPEC "Real ground"'s textures column was the lab's imagery. The ladder's first measurement in this look rewrites it.
