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

- **The cave never sees daylight.** The room (`/r/*`), TV mode, the login
  and landing brand surfaces, and the /dev mocks always render the dark
  set — a `.cave` scope re-asserts the tokens, so they are pixel-identical
  whatever the OS says. Ride legibility was designed against black; that
  design is not renegotiated by an OS setting.
- **Desk surfaces follow `prefers-color-scheme`** — rooms list, workouts,
  editor, history, profile, sensors. No toggle (the 95% rule): the OS
  already asked.
- **Glow exists only in the cave.** On light surfaces the restraint rule
  translates to *saturation marks live data*: `--color-watt` becomes a
  deeper magenta ink, blooms nothing; `--color-neon` stays structural.
- Components never say white or black — the `--color-ink`/`--color-paper`
  pair flips with the scheme, and the zone ramp gets darkened variants so
  the dataviz survives white.
