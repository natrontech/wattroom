# 0005 — Commit to a full synthwave identity, not near-black with one accent

- Status: accepted
- Date: 2026-08-25

## Context

[WATTROOM.md §7](../../WATTROOM.md) called the visual direction "neon glow / synthwave pain cave"
but specified near-black surfaces (`#0a0a0f`) with a single electric watt-yellow accent. Built out
as a styleguide and brand round (#38), that reads as *restrained neon* — a dark dashboard with a
highlight colour — not as synthwave. The restraint rule it protects is real and worth keeping:
glow means "this number is live", so the accent cannot be spent on chrome.

The tension is that synthwave needs colour in the chrome, and the original palette had exactly one
colour to spend.

## Decision

Two hues, with distinct jobs. `--color-neon` (violet `#8b2bff`) is **structural** — horizons,
grids, frames, mark accents — and never glows. `--color-watt` (magenta `#ff3d8b`) remains the
**live-data** hue and is the only thing that glows. Surfaces go violet-black (`#0a0118` /
`#1a0736`). This is the "Outrun" palette, chosen over Miami Nights, Laser Yellow and Tron Ice by
rendering all four live against the same mocks.

Identity: the mark is the **equalizer W** — five bars whose heights trace the letter, so the logo
is literally an interval graph. It animates while a session runs, making the mark double as the
quietest possible "you are riding" indicator. Wordmark stays flat white so the live hue never
leaks into chrome. Type is **Chakra Petch** for display and all numerals over **Barlow** for
running text.

This supersedes the palette half of WATTROOM.md §7. The restraint rule survives unchanged.

## Consequences

- The glow rule gets *easier* to hold: chrome now has a colour of its own, so nothing has to steal
  the live hue to look alive.
- Magenta is a fatiguing hue at high saturation. It is confined to numbers and traces — never
  large fills — and the 2 h endurance ride is the case to re-check during alpha.
- The animated mark needs the ride state at the app shell level, not just inside the player. It
  honours `prefers-reduced-motion`.
- Two accent tokens is one more thing to get wrong. `--color-neon` glowing anywhere is a bug, and
  `/dev/styleguide` carries a right/wrong panel making that concrete.
- Revisit trigger: if alpha riders report the palette is tiring across long sessions, Tron Ice is
  the drop-in fallback — same token names, colder values.

## Amendment — daylight for the desk, never the cave (2026-08-31, #113)

A light scheme exists, but the identity holds its ground:

- **The cave never sees daylight — and the cave is the RIDE.** (Refined on
  rider feedback 2026-08-31: the room's lounge is a desk surface and follows
  the theme.) The dark set is forced while a session runs (countdown /
  running / paused, in the room or the solo player), in TV mode, on the
  spectator view, and on the login/landing brand surfaces and /dev mocks —
  a `.cave` scope flips every token at once, so the lights go down when the
  ride starts and come back up when it ends. Ride legibility was designed
  against black; that design is not renegotiated by an OS setting.
- **Desk surfaces follow `prefers-color-scheme`** — rooms list, workouts,
  editor, history, profile, sensors. No toggle (the 95% rule): the OS
  already asked.
- **Glow exists only in the cave.** On light surfaces the restraint rule
  translates to *saturation marks live data*: `--color-watt` becomes a
  deeper magenta ink, blooms nothing; `--color-neon` stays structural.
- Components never say white or black — the `--color-ink`/`--color-paper`
  pair flips with the scheme, and the zone ramp gets darkened variants so
  the dataviz survives white.

## Amendment — the toggle shipped after all (2026-08-31, #230)

"No toggle" above is superseded: riders asked, and the rail now carries a
three-state cycle (auto → dark → light, `theme.svelte.ts`, persisted). The
95%-rule reading changed with the evidence — scheme preference turned out to
be one of the settings people genuinely differ on. Everything else in the
amendment stands: `.cave` still forces dark and ignores the toggle, glow
still exists only in the cave.

## Amendment — the palette becomes a choice (2026-08-31, #292)

The Outrun values above stop being the only palette and become the *default*
one. Riders pick an accent pair on the profile page: four presets (Outrun,
Tron Ice, Miami Nights, Laser Yellow — the same four this ADR compared) plus
one custom entry that takes a single hue.

What does not change is the part this ADR exists to protect. A palette is
always a **pair with two jobs**: the watt hue marks live data and is the only
thing that glows, the neon hue is structural chrome and never does. The
picker cannot express anything else — the custom entry exposes one hue and
derives the second 65° behind it (the separation the shipped pair ships with),
at Outrun's measured lightness and chroma, so glow behaviour and TV-mode
legibility are inherited rather than re-rolled per rider.

This also discharges the revisit trigger recorded above. "If alpha riders
report the palette is tiring across long sessions, Tron Ice is the drop-in
fallback" is now a setting instead of a future decision, and the magenta
fatigue question no longer needs an ADR to answer — it needs a rider to click
the colder preset.

The three non-Outrun presets are reconstructions: this ADR recorded the
palette *names* it compared, not their values. Their hues match the names and
their lightness/chroma were solved so each accent stays inside sRGB and clears
3.5:1 against its own surface, but they want a design pass against real mocks
before anyone treats them as the ones that lost in 2026-08.

## Amendment — palettes become full themes (2026-09-01, #331)

The accent-only picker above is superseded. A theme now owns every colour
token: both surfaces, muted and foreground colours, the watt/neon pair, and all
seven power zones. Theme definitions provide their identity hues; the complete
token set is derived in OKLCH from family-level lightness and chroma targets.
The relationships are therefore shared rather than hand-tuned eight times.

Each identity has a dark and a white family member. The existing scheme choice
(auto, dark, light) selects the family without changing the chosen identity.
`.cave` still resolves the dark member of that identity, so a ride never takes
on a white surface. Dark surfaces must stay at or below OKLCH L 0.30 and white
surfaces at or above L 0.90.

The derivation is a build contract. Tests require body and muted text to clear
4.5:1 against both surfaces; watt, neon, and every zone bar to clear 3:1; and
adjacent zones to remain distinguishable while moving monotonically in
lightness. Outrun remains the default identity, but its old low-contrast zone
ramp is replaced by the generated, gated ramp. The restraint rule is unchanged:
only live data uses `--color-watt` and glow; `--color-neon` remains flat chrome.

## Amendment — semantic status leaves the data ramp (2026-09-01, #397)

`btn-danger` took its colour from `--color-z6`, so "delete room" was whatever
Coggan zone 6 happened to be in the active theme — pastel pink under Outrun's
gated ramp, and something else again under any theme whose ramp runs elsewhere.
Zone colours are *data* encoding and rotate with the identity; a destructive
control must not.

`--color-danger` is a semantic token outside the ramp. Its hue is fixed at 25°
(OKLCH red-orange) in every theme; only its lightness and chroma follow the
family, contrast-fitted against both surfaces and gated at 3:1 like the
accents, so a rider learns one colour for delete and keeps it after picking
Tron Ice. The corollary is the rule from here on: zone tokens carry zone
readings and nothing else. Errors, failed states, eliminations and destructive
affordances say `danger`. `positive` and `warning` will join it the same way —
fixed hue, family lightness — when something needs them; until then the z4/z5
tones in Banner and the fault surfaces are the call sites waiting for them.

## Amendment — five identities, ten themes (2026-09-05, #693)

This ADR's Decision section still reads as if there is one palette. What
ships in `web/src/lib/themes.ts` is five curated identities — Outrun, Tron
Ice, Miami Nights, Laser Yellow, Monokai — each with a dark and a white
family member, ten themes in total. Outrun remains the default. #402 settled
what the three non-Outrun identities compared in this ADR's Decision actually
are; #612 added Monokai and a design editor for building the next one; #620
added Monokai's white half.

What does not change: a theme is a role assignment (ADR-0023), not a
decoration, and the two-accent split this ADR decided is the invariant every
identity must satisfy — `--color-watt` marks live data and is the only thing
that glows, `--color-neon` is structural chrome and never glows. A sweep of
every `--color-neon` use against every glow/shadow/blur utility in the
current tree found zero violations across all ten themes (the one hit, a
zero-blur focus ring in `web/src/lib/brand/LandingHero.svelte:112`, does not
glow) — the restraint rule held while the palette count grew from one to
five identities.

One thing this amendment does *not* record as settled: `PalettePicker.svelte`
still also offers a free single-hue custom entry (`customTheme()` in
`themes.ts`) alongside the ten curated themes. #692 proposes removing it so
the set is closed, but as of this amendment the custom entry still ships —
the picker is eleven-wide today, not ten.
