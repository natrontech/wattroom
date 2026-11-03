# Spec: The world

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## The world (defaults — tune in alpha; ADR-0066, ADR-0072)

| Parameter             | Value                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pixels                | about **1.0 MP** a frame; **0.5 MP** on the low tier; never under **1** pixel per CSS pixel (or the device's own ratio, where lower), so a desk window bigger than that draws more ([#4256](https://github.com/natrontech/wattroom/issues/4256))                                                                                                                                                                               |
| Look                  | low poly, flat shaded, one colour per face or vertex; no grain, noise or masonry inside a face; no image on a surface but words and the sky; a line never drawn under a pixel wide: past that, a pixel wide at the share it covers (ADR-0092)                                                                                                                                                                                  |
| Frame rate            | **30 fps** on a vsync divisor                                                                                                                                                                                                                                                                                                                                                                                                  |
| High tier             | at most **60** draws and **400k** triangles                                                                                                                                                                                                                                                                                                                                                                                    |
| … figures             | at most **110k** triangles: **3** at LOD0 (**14k** each) and **9** at LOD1 (**7k** each)                                                                                                                                                                                                                                                                                                                                       |
| … far figures         | every figure past those 12 — strangers (Open rides) and the crowd on a climb (Races) — at a far LOD, instanced, inside the tier's totals; its triangles per figure are set by the first `make perf-scenes` measurement, as the GPU gate is                                                                                                                                                                                     |
| … dressing            | at most **24** draws and **180k** triangles                                                                                                                                                                                                                                                                                                                                                                                    |
| Low tier              | at most **30** draws and **150k** triangles; dressing **12** draws and **70k**. **Open, Jan's call:** the slow rig (below) does not hold **30 fps** even inside these ceilings, so they stay until a number is chosen                                                                                                                                                                                                          |
| Fallback              | to the Skyline when more than **20 %** of vsync-divisor intervals are missed over **10 s**; one-way for the ride                                                                                                                                                                                                                                                                                                               |
| Soak                  | two simulated hours at **16×** (`make world-soak`, [#3851](https://github.com/natrontech/wattroom/issues/3851)): no metric's last-**30**-minute mean more than **10 %** over its first-**30**-minute mean (a count may also move by one); textures and geometries never past the first window's ceiling by more than that; the ground never holds more chunks than its streamer's window. Frame times are judged on a GPU only |
| Keep-clear corridor   | the middle **40 %** of the width and **55 %** of the height                                                                                                                                                                                                                                                                                                                                                                    |
| Panels over the world | flat: the surface at **86 %** (the floor is **85 %**), a hairline, no blur; **16 px** in from the canvas and **12 px** apart; a side panel at most **30 %** of the canvas wide, each its content's size ([#3668](https://github.com/natrontech/wattroom/issues/3668))                                                                                                                                                          |
| Moment card           | top-centre while about **300 px** (its narrowest at **24 px** words) stay free between slot 1 and the jukebox seat; otherwise at the top of the right column, directly under the seat, at most **30 %** wide (Jan, 2026-10-06)                                                                                                                                                                                                 |
| People column         | folds into its sheet while a session rides in the world, at any width; the jukebox player takes the riding surface's seat and the crew panel sits under it (Jan, 2026-10-07)                                                                                                                                                                                                                                                   |
| Short window          | under **860 px** tall the ride takes the flat surface and says so in one line; the world returns when the window grows (Jan, 2026-10-07; 820 until #3645's CLIMB page). A phone (under **768 px**) is exempt: its panels stack in one column the page scrolls, and the world is a **240 px** band in slot 2's place (#3676)                                                                                                    |
| GPU gate              | set by the first `make perf-scenes` measurement; proposal: at most **5** points of GPU on #2998's rig                                                                                                                                                                                                                                                                                                                          |
| Ride sky              | lit by the sky only; sun **−4°** at the start to **−8°** at the finish by the ride's progress, **−6°** with no known end                                                                                                                                                                                                                                                                                                       |
| Alpenglow             | OKLCH hue **58–60°**                                                                                                                                                                                                                                                                                                                                                                                                           |
| Flashes               | WCAG 2.3.1, and at most one dim flash per **10 s** over **25 %** of a 10° field; none under reduced motion                                                                                                                                                                                                                                                                                                                     |
| Live zone ring        | one flat band **0.08 m** wide (a wheel, as your trail), an ellipse round the wheels **0.84 m** across — inside the **0.9 m** between riders abreast — and **1.98 m** along, in the live zone's colour; under you and every rider whose numbers you may see (ADR-0059); none on a faded rider or under a game that hides the meter                                                                                              |
| Name tags             | over the **2** riders nearest you and anyone speaking, never over you; a small dark pill holding the name and, where known, the level (`Lv 38`); text at least **16 arcmin** at the design distance (**20 px** in a 900 px frame); tags that would overlap merge                                                                                                                                                               |

**The slow rig** stands for the low tier: headless Chromium on SwiftShader with
the page's CPU throttled **4×** (`make world-bench`, [#3082](https://github.com/natrontech/wattroom/issues/3082)).
It draws /dev/perf's world case, the synthetic pass loop with four riders, for
60 s after a 15 s warm-up. These are software-rig numbers, not a real device's.
Measured on the dev VM (16 cores, shared), 2026-11-03:

| Frame       | Frame interval p50 / p95 | Render JS p50 / p95 | Intervals missed | Draws p50 / max | Triangles p50 / max |
| ----------- | ------------------------ | ------------------- | ---------------- | --------------- | ------------------- |
| 0.92 MP     | **99.6 / 203 ms**        | **15.6 / 26.1 ms**  | **66 %**         | **24 / 25**     | **145k / 148k**     |
| 0.52 MP     | **84.7 / 169 ms**        | **13.5 / 22.1 ms**  | **62 %**         | **24 / 25**     | **145k / 148k**     |
| unthrottled | 93.4 / 185 ms            | 3.3 / 6.7 ms        | 65 %             | 24 / 25         | 145k / 148k         |

The unthrottled row is at 0.92 MP. On this rig the scene's counts already fit
the low tier, yet every run is past the Fallback. 0.52 MP instead of 0.92 saves about
**15 ms**, and the throttle adds about **12 ms** of the page's own work. The
rest is SwiftShader drawing the scene in the GPU process, which no throttle
slows. The low tier's ceilings are open until Jan chooses one of these:

- set them to what holds 30 fps on this rig, well under today's, which would
  also cut what a real low-tier GPU draws;
- keep them, and let a GPU-less machine take the Skyline, as the Fallback
  already does.

## Real ground (defaults — tune in alpha; ADR-0078, ADR-0092)

| Parameter         | Value                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Near heights      | swissALTI3D **2 m**, averaged to **4 m**                                                               |
| Far heights       | swissALTIRegio **80 m**, out to **±60 km**, with the earth's curvature                                 |
| Panorama stations | on a global **2 km** grid                                                                              |
| Look pack ceiling | **50 GB** for Switzerland, checked against the one-canton pilot first                                  |
| Imagery           | none: one flat colour per land-cover class, swissTLM3D in Switzerland and WorldCover abroad (ADR-0092) |
| Height tiles      | lossless Terrarium WebP (rule)                                                                         |

**The ladder** starts from the realism lab's fast-rig numbers (an M2 Pro at
1280×720, 30 fps); M20's measurements, the slow rig's included, rewrite them:

| Rung | GPU per frame | Triangles  | Textures   |
| ---- | ------------- | ---------- | ---------- |
| L1   | **1.95 ms**   | —          | —          |
| L2   | **2.5 ms**    | **0.58 M** | **109 MB** |
| L3   | **4.15 ms**   | **0.92 M** | **170 MB** |

The lab did not report L1's triangles or textures; its first measurement
fills them in. The lab's textures were its imagery, which ADR-0092 drops, so
the first measurement in the flat look rewrites that column.

**Climbing the ladder** ([#3295](https://github.com/natrontech/wattroom/issues/3295)) applies to every
world, generated or real. A rung is the pixels of "The world" above and the
dressing's own rings, so measurement rewrites these numbers, never the rule:

| Rung | Pixels           | Dressing drawn out to          |
| ---- | ---------------- | ------------------------------ |
| L3   | about **1.0 MP** | **2,500 m**, its far stand-ins |
| L2   | about **1.0 MP** | **600 m**, the near ring only  |
| L1   | **0.5 MP**       | **600 m**                      |

| Parameter  | Value                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Probe      | the count-in: GPU time a frame from `EXT_disjoint_timer_query_webgl2` where the browser has it; else the share of vsync-divisor intervals missed                                                                 |
| Start      | the highest rung whose p90 GPU time is at most **10 ms** at 30 fps, each rung's predicted from the probed one by the GPU-per-frame column above; on missed intervals, one rung under the probed one past **5 %** |
| Step down  | one rung when a **10 s** window misses more than **5 %** of its intervals or its p90 GPU time passes **16 ms**, **twice** in a row; it shrinks and hides, never rebuilds, and draws no frame over **50 ms**      |
| Step up    | never mid-ride. The next ride's count-in may climb **one** rung, when that rung's predicted p90 leaves at least **40 %** of the 10 ms; a probe without GPU time measures no headroom and never climbs            |
| Remembered | per device, in `wattroom.world.tier.v1`, keyed by renderer and canvas size                                                                                                                                       |
| Light      | the World control's Light caps the ladder at L1; Flat draws no world                                                                                                                                             |
| Floor      | L1, and under it the Skyline: the Fallback above still judges every rung                                                                                                                                         |

## The living world (defaults — tune in alpha; #3178)

What dresses the road beside the budgets of "The world" above.

| Parameter  | Value                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corridor   | at most **150 KB** gzipped per **50 km**                                                                                                                                                                                                                                    |
| Land cover | weights OSM **1.0** > WorldCover **0.7** > generator **0.4**; edges warped **±6 m**; meadow below **1,300 m**, pasture above                                                                                                                                                |
| Buildings  | footprints fitted at **0.7–1.4×** scale                                                                                                                                                                                                                                     |
| Water      | streams shown within **300 m** of the road; lakes reflect with Schlick F0 **0.02**                                                                                                                                                                                          |
| Set pieces | a generated one never within **90 s** of a real landmark of the same class                                                                                                                                                                                                  |
| Trees      | three conifer forms (spruce, slender spruce, fir) and three broadleaf (three lumps, one round crown, an oval), one per tree by its place; above **1,300 m** most spruces are slender; each tree its own shade ([#4256](https://github.com/natrontech/wattroom/issues/4256)) |
| Snow poles | every **25 m** above **1,100 m**                                                                                                                                                                                                                                            |
| Animals    | at most **80** in one draw, birds at most **40**; a cow turns its head toward riders within **60 m**                                                                                                                                                                        |
| Ambience   | at most **6** voices; **−12 dB** under music; at most **8** one-shots a minute                                                                                                                                                                                              |
| Fog sea    | September to April, its top at **700–1,000 m**, clamped so the climb crosses it                                                                                                                                                                                             |
| Rain       | at most **3,000** streaks                                                                                                                                                                                                                                                   |
| Crowds     | solo: **0–1** locals per km; a session: about **20** at the summit                                                                                                                                                                                                          |
| Postbus    | at most once per **20 min**                                                                                                                                                                                                                                                 |
| Weather    | lookups cached **1 h** per **0.1°** cell                                                                                                                                                                                                                                    |
