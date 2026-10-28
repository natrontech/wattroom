# 0066 — The world is the ride view

- Status: accepted; settles [#3062](https://github.com/natrontech/wattroom/issues/3062)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §1 — "no virtual world … no 3D"; marked there
- Supersedes: the Ride Worlds draft "Broadcast: 3D is a view, never the ride" (#3020's first body, #3031, the design notes)
- Amends: [0046](0046-one-riding-surface.md) — on a road, the five slots become docks around the world
- Beside: [0062](0062-the-horizon-may-be-a-road.md) (what a road is), [0079](0079-motion-announces-the-camera-stays-still.md) (the camera and the World control), [0081](0081-the-world-is-keyed-by-place.md) (what a world is a function of)

## Context

ADR-0062 lets any ride carry a road. The first draft of Ride Worlds kept the
3D world at arm's length: a broadcast for screens nobody pedals at, and a TV
toggle, off by default. On 2026-09-26 Jan decided the other way: **the world is
the ride view**, and the 2D Skyline is its automatic fallback.

A world on the screen a rider pedals in front of has to earn that place. It
shares the GPU with LiveKit video, it must never make the numbers harder to
read, it cannot be allowed to fail on click, and a rider who gets motion-sick
has to be able to turn it down in one tap.

## Decision

### On a road, slot 2 is the world

- With a road, **slot 2 defaults to the world** on every riding surface. It
  ships behind a flag until the riding-surface check
  ([#3082](https://github.com/natrontech/wattroom/issues/3082)) has passed.
- **ADR-0046's five slots become docks** around the canvas, with a
  **keep-clear corridor** in the middle 40 % of the width and 55 % of the
  height. Nothing is drawn over the road ahead.
- **Focus priority**: sprint > a game without a road > a shared screen > the
  world > the instrument.
- A ride with no road keeps today's surface. The ramp test never gets a road.

### The fallback is the Skyline, automatic and one-way

The world falls back to the **Skyline** by itself, and once it has, it stays
there for the rest of the ride: a view that flickers between two renderers is
worse than either. The fallback is keyed on **capabilities and the measured
tier**, never on screen width:

- no WebGL2, or a missing capability the renderer needs (a missing
  `WEBGL_multi_draw` is one input among them — Firefox lacks it on about 5 % of
  devices);
- a lost context;
- a world that fails to build;
- **missed frames**, counted as missed vsync-divisor intervals and not as the
  JS time of `render()`, which measures only CPU submission.

A phone with Web Bluetooth rides, so "narrow" is not a reason to fall back.

### The World control, and the camera

How much the world moves is one per-device **World control** — Full, Steady,
Light, Flat — and the camera is a tripod on a rail whose field of view widens
by at most 4°. Both are [ADR-0079](0079-motion-announces-the-camera-stays-still.md)'s.
Under reduced motion the control opens on **Flat**, with a one-tap steady
camera.

### What a world is, and what it may touch

- **A world is a function of the place and its data snapshot** (ADR-0081). The
  route decides only the coverage and the line ridden. This supersedes the
  header of `$lib/world/world.ts`, "A world is a pure function of the Route".
- **Rendering never drives the trainer.** The world reads the ride; nothing in
  it writes to the ride or to a trainer.
- The desktop shell **pauses the world** while its window is hidden.
- **Plain three.js**, pinned at 0.186.1, only under `$lib/world`, loaded lazily:
  zero bytes of it in the eager vendor chunk or in the public `(site)` pages.

The budgets are in docs/SPEC.md's "The world" section.

## Consequences

- A rider on a road sees their road, not a graph of it, and a machine that
  cannot draw the world still gets a working ride on the Skyline.
- Every new riding-surface element names its dock and stays out of the
  keep-clear corridor.
- The world's cost is measured before it is on by default: `make perf-scenes`
  on the #2998 rig decides the GPU gate.
- The code on `main` from the dev world (#3036) predates these numbers:
  `budget.ts` spends 1.6 MP a frame against SPEC's 1.0, and `world.ts` still
  says a world is a function of the route. The renderer
  ([#3078](https://github.com/natrontech/wattroom/issues/3078)) takes the
  budget from SPEC, and ADR-0081's work rewrites the header.
- [ADR-0078](0078-real-ground-painted-light.md) (real ground) amends this with
  its quality ladder.
- WATTROOM.md §1's "no virtual world" and "no 3D" are marked; roads and maps
  were marked by ADR-0062 and ADR-0070.

## Amendment, 2026-09-29 (#3283): Amended by ADR-0078 — the quality ladder

[ADR-0078](0078-real-ground-painted-light.md) adds real ground and a quality ladder, **L1–L3**, measured at the
count-in and never stepped up mid-ride. The World control caps it (ADR-0079):
Full takes the measured rung, Light caps at L1, and Flat skips real ground. The
fallback to the Skyline and its triggers are unchanged.

## Amendment, 2026-10-16 (#3084): 3D is the rider's to turn on

Decided by the maintainers, 2026-10-16. **3D is an optional setting: a rider's
default is Flat, and the rider opts into 3D.** This replaces "with a road,
slot 2 defaults to the world" above and #3084's first scope, "the world
becomes the default ride view". On a road the ride opens on the Skyline
until the rider picks a 3D look.

- **One control.** The World control (ADR-0079) is the switch: never chosen
  is Flat; Full, Steady and Light draw the world on a ride with a road, when
  the browser can. The per-browser world-slot flag that only /dev/world set
  is gone; a browser that had it on keeps its world once, as Full.
- **Where a rider finds it.** Settings → Appearance shows it in the open,
  not behind Advanced. Mid-ride on a road, the flat road's status line says
  where 3D is and offers **Ride in 3D**; the world's slot-1 row has a 44 px
  **Flat road** button. Either tap takes effect at once and is the rider's
  new World control on this device.
- **A browser that cannot draw the world is read first**: its flat road
  says so and offers no 3D button that would fail (errors.md).
- **Reduced motion** still opens on Flat while nothing is chosen, with the
  one-tap steady camera (ADR-0079).
- **Measurement no longer gates the default.** #3082's two-rig GPU budget
  keeps its value for riders who opt in, but an opt-in world ships without
  waiting for it. The fallback to the Skyline and its triggers are unchanged.

## Amendment, 2026-10-28 (#4256): Amended by ADR-0092, pixels before polygons

[ADR-0092](0092-the-world-draws-flat.md) puts a floor of one pixel per CSS pixel under SPEC's 1.0 MP budget, so
a desk window bigger than the budget draws more. When a rig cannot afford a
frame, the quality ladder gives up geometry first and resolution never goes
under the floor. The fallback to the Skyline and its triggers are unchanged.
