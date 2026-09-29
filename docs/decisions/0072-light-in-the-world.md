# 0072 — Light in the world: the ride stays in the cave

- Status: accepted; settles [#3064](https://github.com/natrontech/wattroom/issues/3064)
- Date: 2026-09-29
- Amends: [0005](0005-synthwave-visual-identity.md) — the cave rule and the glow rule, for a 3D world
- Beside: [0066](0066-the-world-is-the-ride-view.md) (the world is the ride view), [0064](0064-the-roadside.md) (the roadside's flash limit), [0079](0079-motion-announces-the-camera-stays-still.md) (reduced motion)
- Decided by Jan: Alpine blue hour for the ride, golden hour and a pastel diorama for desk previews (2026-09-26); the light darkens with the ride (2026-09-29)

## Context

ADR-0005 says the cave never sees daylight, and that the cave is the ride.
Glow exists only in the cave, and only live data glows. A 3D world is a new
kind of surface under both rules: it has a sky, a sun, lamps and weather, and
every one of them could glow, flash or wash the numbers out.

The themes (`themes.ts`) put the dark identities' watt at OKLCH hues 2, 18,
100 and 200. Anything the world paints warm has to stay clear of all four, or
it reads as live data.

## Decision

### The ride is blue hour, and it darkens as you ride

- The ride's sky is **blue hour or night**: the sun at or below **−4°**. It is
  lit by the **sky only** — no sun key light, no cast shadows.
- **The light darkens with the ride.** The sun goes from **−4° at the start to
  −8° at the finish**, driven by the session's progress (the shared clock, or
  the plan's time alone), so a session and its spectators share one sky and
  every ride ends at first night. A ride with no known end holds **−6°**.
- **Stars fade in** only as the zenith darkens.
- The sun's **azimuth is the real one**, computed with SunCalc at a point
  rounded to 0.1°.
- **Alpenglow is peach**: an OKLCH hue pinned to **58–60°**, at least 40° from
  every dark identity's watt hue. Never pink.
- **Golden hour and the pastel diorama** appear only on desk previews: the
  garage, the route page and the poster. Never on a ride.

### Only your own line glows

- **NoToneMapping, no bloom, no emissive materials.** (A tone curve for the
  world is [#3291](https://github.com/natrontech/wattroom/issues/3291)'s,
  under its own amendment.)
- **Only your own trail and dot glow** — on a spectator's screen, the followed
  rider's. Everything else in the world is paint.
- Lit windows, bonfires and lamps are **flat, unlit colour**.

### Weather and flashes

- **Weather is atmosphere only**; it changes nothing a rider rides.
- **Flashes** meet WCAG 2.3.1, and more: at most **one dim flash per 10 s**
  over **25 %** of a 10° field, and **none under reduced motion**. The zone 6
  and zone 7 colours, the danger token and watt **never blink**.

### Themes

- The world keeps **its own looks** and does not follow the rider's theme
  family.
- Its **accents** — watt, neon, the zones — and every HUD panel **follow the
  viewer's theme**.
- The world's colours are a **token family in `app.css`**, so
  `no-raw-hex.test.ts` stays green.

The numbers are in docs/SPEC.md's "The world" section.

## Consequences

- The numbers stay the brightest thing on the screen: the world is dark, its
  lamps do not glow, and only the rider's own line shares watt's light.
- Every ride ends in the same place, first night, which is a look the rider
  learns to expect rather than a clock they have to read.
- A world colour is a token like any other; a hex in `$lib/world` is a failing
  test.
- [ADR-0078](0078-real-ground-painted-light.md) (real ground) amends the tone
  curve with #3291.
- Implementation: [#3085](https://github.com/natrontech/wattroom/issues/3085),
  [#3187](https://github.com/natrontech/wattroom/issues/3187).

## Amendment, 2026-09-29 (#3283): Amended by ADR-0078 — one tone curve for world materials

[ADR-0078](0078-real-ground-painted-light.md) replaces `NoToneMapping` for world materials with one hue-preserving
curve, `NeutralToneMapping`. The rider's own dot, the zone ring and every watt
accent set `toneMapped: false`, so ADR-0005's tokens never drift. The sky's hue
stays art-directed to this ADR's blue hour. #3291 builds it.
