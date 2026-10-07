# Spec: The world

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## The world (defaults — tune in alpha; [ADR-0066](../decisions/0066-the-world-is-the-ride-view.md), [ADR-0072](../decisions/0072-light-in-the-world.md))

| Parameter           | Value                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pixels              | about **1.0 MP** a frame; **0.5 MP** on the low tier                                                                                                                                                                                                                                                                              |
| Frame rate          | **30 fps** on a vsync divisor                                                                                                                                                                                                                                                                                                     |
| High tier           | at most **60** draws and **400k** triangles                                                                                                                                                                                                                                                                                       |
| … figures           | at most **110k** triangles: **3** at LOD0 (**14k** each) and **9** at LOD1 (**7k** each)                                                                                                                                                                                                                                          |
| … far figures       | every figure past those 12 — strangers (Open rides) and the crowd on a climb (Races) — at a far LOD, instanced, inside the tier's totals; its triangles per figure are set by the first `make perf-scenes` measurement, as the GPU gate is                                                                                        |
| … dressing          | at most **24** draws and **180k** triangles                                                                                                                                                                                                                                                                                       |
| Low tier            | at most **30** draws and **150k** triangles; dressing **12** draws and **70k**                                                                                                                                                                                                                                                    |
| Fallback            | to the Skyline when more than **20 %** of vsync-divisor intervals are missed over **10 s**; one-way for the ride                                                                                                                                                                                                                  |
| Keep-clear corridor | the middle **40 %** of the width and **55 %** of the height                                                                                                                                                                                                                                                                       |
| GPU gate            | set by the first `make perf-scenes` measurement; proposal: at most **5** points of GPU on #2998's rig                                                                                                                                                                                                                             |
| Ride sky            | lit by the sky only; sun **−4°** at the start to **−8°** at the finish by the ride's progress, **−6°** with no known end                                                                                                                                                                                                          |
| Alpenglow           | OKLCH hue **58–60°**                                                                                                                                                                                                                                                                                                              |
| Flashes             | WCAG 2.3.1, and at most one dim flash per **10 s** over **25 %** of a 10° field; none under reduced motion                                                                                                                                                                                                                        |
| Live zone ring      | one flat band **0.08 m** wide (a wheel, as your trail), an ellipse round the wheels **0.84 m** across — inside the **0.9 m** between riders abreast — and **1.98 m** along, in the live zone's colour; under you and every rider whose numbers you may see (ADR-0059); none on a faded rider or under a game that hides the meter |
| Name tags           | over the **2** riders nearest you and anyone speaking, never over you; a small dark pill holding the name and, where known, the level (`Lv 38`); text at least **16 arcmin** at the design distance (**20 px** in a 900 px frame); tags that would overlap merge                                                                  |

## Real ground (defaults — tune in alpha; [ADR-0078](../decisions/0078-real-ground-painted-light.md))

| Parameter         | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Near heights      | swissALTI3D **2 m**, averaged to **4 m**                               |
| Far heights       | swissALTIRegio **80 m**, out to **±60 km**, with the earth's curvature |
| Panorama stations | on a global **2 km** grid                                              |
| Look pack ceiling | **50 GB** for Switzerland, checked against the one-canton pilot first  |
| Imagery           | **0.5 m**, or **2 m** if the pilot extrapolates over the ceiling       |
| Height tiles      | lossless Terrarium WebP (rule)                                         |

**The ladder** starts from the realism lab's fast-rig numbers (an M2 Pro at
1280×720, 30 fps); M20's measurements, the slow rig's included, rewrite them:

| Rung | GPU per frame | Triangles  | Textures   |
| ---- | ------------- | ---------- | ---------- |
| L1   | **1.95 ms**   | —          | —          |
| L2   | **2.5 ms**    | **0.58 M** | **109 MB** |
| L3   | **4.15 ms**   | **0.92 M** | **170 MB** |

The lab did not report L1's triangles or textures; its first measurement
fills them in.

## The living world (defaults — tune in alpha; #3178)

What dresses the road beside the budgets of "The world" above.

| Parameter  | Value                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Corridor   | at most **150 KB** gzipped per **50 km**                                                                                     |
| Land cover | weights OSM **1.0** > WorldCover **0.7** > generator **0.4**; edges warped **±6 m**; meadow below **1,300 m**, pasture above |
| Buildings  | footprints fitted at **0.7–1.4×** scale                                                                                      |
| Water      | streams shown within **300 m** of the road; lakes reflect with Schlick F0 **0.02**                                           |
| Set pieces | a generated one never within **90 s** of a real landmark of the same class                                                   |
| Snow poles | every **25 m** above **1,100 m**                                                                                             |
| Animals    | at most **80** in one draw, birds at most **40**; a cow turns its head toward riders within **60 m**                         |
| Ambience   | at most **6** voices; **−12 dB** under music; at most **8** one-shots a minute                                               |
| Fog sea    | September to April, its top at **700–1,000 m**, clamped so the climb crosses it                                              |
| Rain       | at most **3,000** streaks                                                                                                    |
| Crowds     | solo: **0–1** locals per km; a session: about **20** at the summit                                                           |
| Postbus    | at most once per **20 min**                                                                                                  |
| Weather    | lookups cached **1 h** per **0.1°** cell                                                                                     |
