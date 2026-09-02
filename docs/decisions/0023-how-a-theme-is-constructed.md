# 0020 — How a theme is constructed

- Status: accepted
- Date: 2026-09-01

## Context

[ADR-0005](0005-synthwave-visual-identity.md) fixed *which* colours WattRoom
uses. #331 made themes generate all of them. Nothing recorded **how** a palette
is supposed to be built, so the generator encoded one person's assumptions, and
where those were wrong it produced worse colour with a green test suite.

Concretely (#396): the gate measured WCAG contrast and nothing else, so the
solver satisfied it by draining chroma. Z7 — neuromuscular, the hardest effort
a rider produces — shipped as `#ffc5d4`, a pale pink, having lost 72% of its
chroma. It passed every check we had.

## Decision

Colour is assigned by **role**, and each role carries a contrast requirement
*and* a chroma budget. Themes are derived from those rules, and the rules are
gated in CI.

### 1. Roles, not colours

Six: surfaces, chrome, live data, the zone scale, semantic status, and text.
Chroma is budgeted by **area** — surfaces near-neutral, chrome low, live data
high, text lowest. Large fills never carry high chroma; saturation is spent on
small marks that mean something. That is ADR-0005's restraint rule arriving
from physiology rather than taste, which is why it is not tradeable for style.

### 2. Apparent intensity is chroma *and* lightness

The Helmholtz–Kohlrausch effect: a saturated colour reads brighter than an
equally-luminant pale one. A gate measuring only luminance contrast will
therefore accept a washed-out colour as an improvement. **Chroma has floors,
not just ceilings.** It is a design variable, never slack for a solver.

### 3. Contrast targets differ by role, and one number is not enough

- Body text: WCAG AA 4.5:1.
- Large numerals: nominally 3:1, but treated as 4.5:1 — the rider is three
  metres away, moving, and sweating.
- Zone fills: 3:1 as graphical objects that carry meaning, except where the
  reference identity is deliberately lower (Z1 is recovery and is *meant* to
  recede at 1.9:1). There the reference is the floor.
- Adjacent zones: not a contrast question at all. Contrast is measured against
  the background and cannot detect two zones being the same colour. That is
  perceptual distance (ΔE).

WCAG 2's ratio is symmetric and is known to over-rate light-on-dark; it was
built for dark ink on paper. For a dark-first app it will pass text that reads
badly. APCA models polarity and predicts dark UI better, but is a WCAG 3 draft:
we gate on AA, and treat APCA as a reported signal, not a pass/fail.

### 4. The zone ramp is a colormap, not chrome

It wants even perceptual steps and monotonic *apparent intensity* — not
monotonic lightness. The shipped Outrun ramp peaks in lightness at Z5 and
descends into Z6/Z7 while chroma keeps climbing. That is what keeps the hot end
vivid, and mistaking it for a defect is what caused #396.

**The ramp is therefore shared by every theme, not themed.** Two reasons, and
the second was discovered while implementing this:

- Zone colour is *learned*. A rider reads "green is threshold" across the room;
  rotating the scale per palette makes them relearn it for a cosmetic choice.
  Coggan zones are closer to a standard than to branding.
- The sRGB gamut does not rotate evenly. Outrun's ramp works partly because its
  dark steps are violet and blue and its bright ones are cyan, green and amber
  — hues that can hold chroma at those lightnesses. Rotating the same
  lightness/chroma pairs onto another hue journey clamps them out of gamut,
  which is exactly the washing-out this ADR exists to prevent.

Themes own surfaces, chrome, accents and semantic colour. The data scale is
fitted to each theme's surfaces for contrast, but keeps its hues.

### 5. Fatigue over a two-hour ride constrains the palette

Not blue light — that evidence is thin. What matters:

- **Screen luminance against a dark room.** This is dark mode's actual job.
- **Halation.** Pure white on near-black blooms and smears, worst for
  astigmatism. Ink belongs near L 0.90, not 1.0, and surfaces stay off pure
  black — which also avoids OLED smearing on scroll.
- **Longitudinal chromatic aberration.** The eye cannot focus saturated blue
  and red at one depth, so saturated colour must be small, brief and meaningful.
- **Adaptation and afterimages.** Large saturated fills shift perception; after
  twenty minutes the violet room reads neutral.
- **Colour vibration.** Complementary hues at equal luminance shimmer, because
  there is no luminance edge for the eye to lock onto. Two accents must differ
  in lightness, not only in hue.

### 6. Harmony is a geometry

Per identity: three hue anchors with enforced separation — surface and chrome
analogous (within ~20°), live data far from both. A theme is three numbers plus
these rules.

### 7. Gamut

sRGB leaves saturation unused on modern displays. `oklch()` expresses P3 with a
fallback, and that headroom is how a vivid Z7 stays inside a contrast floor.

## Consequences

- #396 and #401 are implementations of this, not independent judgement calls.
- The gate grows chroma floors, ΔE between adjacent zones, and a colour-vision
  simulation done in linear light.
- `--color-ink` at pure white becomes a finding rather than a given.
- The reference identity's tokens are pinned. A derivation change must not
  silently move Outrun again, which is exactly what happened between #331 and
  #396.
- #399's gallery is the counterpart: the numbers say legible, only the page
  says whether it is any good.

## Notes

Three ADRs are currently numbered 0019 (#379); this one takes 0020 and does not
add to that collision.

Background reading for the harmony section: Agustina Feijóo, *Comprehensive
guide for color usage in web design* (freeCodeCamp, 2017) — the colour-wheel
geometry and the colour-vibration warning come from there.
