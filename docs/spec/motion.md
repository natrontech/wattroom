# Spec: Motion

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Rider animation (defaults — tune in alpha; #3066)

How a rider's figure in a ride world moves. Every number here replaced one the world prototype
invented (#3021): a cadence of 68 + W/9 rpm, sprint thresholds of 1.6/1.3 × FTP, a 0.25 s time
constant and a 0.12 rock. `r` is the rider's power ÷ their FTP; grade is the road's, in %.

**Cadence and stopping**

- A rider whose trainer reports **no cadence** pedals at the jukebox's effort tiers (Voice
  channel audio defaults, BPM matching): **≤ 55 % FTP → 80 rpm**, **≤ 75 % → 85**,
  **≤ 90 % → 90**, **above → 95 rpm**.
- **Stopped** is Ride guards' stopped: cadence below **5 rpm** and power below **20 W**.
- **Coasting** turns the cranks forward only, to the next level position, within **1.2 s**.

**Postures**

| Posture        | Enters                                                                      | Exits                                             | Held at least |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------- | ------------- |
| Sprint         | r ≥ **1.6** (≥ **1.2** while a sprint moment is armed) and cadence ≥ **50** | r below **1.2** (below **1.0** while armed)       | **2 s**       |
| Standing climb | grade ≥ **5 %**, cadence < **72** and r ≥ **0.8**, for **2 s**              | cadence > **78**, grade < **3 %** or r < **0.65** | **3 s**       |
| Stretch stand  | for **8–15 s** every **180–360 s**, on grades of **5 %** or more            | when its 8–15 s are up                            | —             |
| Tuck           | coasting at ≥ **50 km/h** on a grade of **−4 %** or steeper                 | below **42 km/h**                                 | **1.5 s**     |
| Drops          | ≥ **45 km/h**, or r ≥ **1.2**                                               | —                                                 | —             |
| Tops           | grade ≥ **4 %** with r < **0.55**                                           | —                                                 | —             |

**Springs** (half-lives): cadence **0.3 s** (**0.5 s** for remote riders), stand **0.25 s**,
lean **0.3 s**, steer **0.15 s**.

**Motion**

- **Sway**: **0.6° × r** seated, **4° × r** climbing, **9° × r ÷ 1.6** sprinting.
- **Lean** = atan(v²κ ÷ g), clamped to **16–22°** while pedalling and **32°** coasting.

## Motion (defaults — tune in alpha; [ADR-0079](../decisions/0079-motion-announces-the-camera-stays-still.md))

**Durations and timings** (`app.css` `@theme`, mirrored in `$lib/motion`):

| Token          | Value      | Token              | Value       |
| -------------- | ---------- | ------------------ | ----------- |
| `--dur-press`  | **90 ms**  | `--dur-stage`      | **700 ms**  |
| `--dur-quick`  | **160 ms** | `--dur-draw`       | **1200 ms** |
| `--dur-base`   | **240 ms** | `--hold-announce`  | **2400 ms** |
| `--dur-reveal` | **400 ms** | `--stagger`        | **60 ms**   |
| `--dur-live`   | **500 ms** | `--stagger-podium` | **400 ms**  |

**Easings**: `--ease-arrive` cubic-bezier(0.05, 0.7, 0.1, 1); `--ease-leave`
cubic-bezier(0.3, 0, 0.8, 0.15); `--ease-move` cubic-bezier(0.2, 0, 0, 1);
`--ease-live` cubic-bezier(0, 0, 0.2, 1); `--ease-pop` a `linear()` spring,
ζ ≈ **0.63**, **8 %** overshoot. The watts numeral keeps its **250 ms**
transform glide (#3200).

**The camera**: follow first order or critically damped; FOV at most **+4°**
over base with a **2 s** half-life; a shot change is a cut or a **300 ms**
fog-dip.

**The World control**: Full, Steady (heli camera, fixed FOV, cuts, no
particles), Light (the lowest 3D tier), Flat (the Skyline). Per device, stored
in `wattroom.world.mode.v1`; reduced motion opens on Flat, with one tap to
Steady.

**Count-in reveal** (#3087, `world/reveal.ts`): cue the count-in's first frame,
hit time the start of its last **3 s**. The eye opens **200 m** back and
**100 m** up looking at the first climb's top (**3 km** ahead with no climb
within **8 km**), and descends to a pose 11 m back of the START arch, capped at
**60 m/s** and **20°/s**. The last 3 s hold still with the digit on the arch's
banner. A late opener lands mid-path. Steady and reduced motion: that held
pose for the whole count-in.

**Slots dock in** (#3087, `moments` kind `dockin`, `RidingSurface`): cue the
count-in's first frame, hit time **`--dur-stage`** (700 ms) later. Each slot
flies **40 px** from its edge on `--ease-arrive`, staggered by `--stagger`.
Reduced motion: the slots stand in place from the first frame.

**The climb's moments** (#3645, `moments` kinds `climb`, `flamme`, `summit`,
`ride/climb-cues.svelte.ts`): one at a time, lowest priority after the summit.

- `climb`: cue `climb` as the card opens, hit when the CLIMB page's slide-in
  ends (**`--dur-stage`**, **40 px** from its edge, `--ease-arrive`).
- `flamme`: no sound. The flamme rouge flag stamps on `--ease-pop` over
  **`--dur-base`** when the last kilometre begins, then stays while it lasts.
- `summit`: cue `summit` as the strip rises above the Skyline, hit when its
  **`--dur-stage`** ends, held **`--hold-announce`**. Confetti falls from the
  strip over **`--dur-draw`** at HC and I only, staggered by **`--stagger`** ÷ 3.
  Steady carries no confetti. Reduced motion keeps every cue and holds each
  stamp.

**Steady** (default; `world/rig.ts`): heli camera **260 m** back and **190 m**
up, fixed FOV **45°**, cuts instead of moves, no particles or confetti, lean
×**0.5**, vegetation sway ×**0.3**. Crank and wheels keep turning, because they
are data. **Light** draws at **0.5 MP** (Full: 1.0 MP) until the quality ladder
has a lower tier.

**Flashes**: WCAG 2.3.1; at most one luminance flash per **10 s** over **25 %**
of a **10°** field.
