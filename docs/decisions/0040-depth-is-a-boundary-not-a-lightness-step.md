# 0040 — Depth is a boundary, not a lightness step

- Status: accepted
- Date: 2026-09-08
- Answers: [#613](https://github.com/natrontech/wattroom/issues/613) (the
  "unfinished" feeling that isn't about colour) and
  [#621](https://github.com/natrontech/wattroom/issues/621) (what the theme
  gate should check), which turned out to be one finding seen from two ends
- Sits beside: [0023](0023-how-a-theme-is-constructed.md), whose gate and
  shared zone ramp are untouched — this changes what design is allowed to
  spend, not what the gate measures
- Constrained by: [0005](0005-synthwave-visual-identity.md) — two accents,
  `--color-watt` for live data and the only thing that glows, `--color-neon`
  structural and never glowing. Nothing here touches either

## Context

Three of the four theme identities were solved for a contrast gate and never
art-directed, which [#402](https://github.com/natrontech/wattroom/issues/402)
addresses. Sitting with that diagnosis, the remaining complaint was that the
app still felt unfinished in Outrun too — the one identity that *did* get a
design pass. So the cause was not hue.

Measuring the running app rather than reading the CSS found four mechanical
causes, and they share a root:

- **Two surfaces.** `--color-surface` and `--color-surface-raised` were the
  whole ladder, so `bg-surface` — the page background — was painted *on top of*
  raised elements 75 times to fake a recess that had no name.
- **Eighteen borders.** ~370 border declarations across 18 colour/alpha
  combinations (`border-muted/15` ×97, `border-ink/5` ×62, `border-muted/25`
  ×59, …), while `--color-edge`, added for exactly this job in
  [#505](https://github.com/natrontech/wattroom/issues/505), was used 7 times
  and 6 of those were under `/dev`.
- **No elevation.** No `box-shadow` in the token layer at all. The twelve call
  sites that wanted depth used Tailwind's `shadow-lg`/`shadow-2xl`, which are
  black — invisible on a near-black cave surface, the wrong shape on paper.
- **Five sizes called "small".** 419 call sites set an arbitrary pixel size
  (`text-[11px]` ×206, `text-[10px]` ×171, `text-[13px]` ×24, …) against 507
  `text-xs` and 339 `text-sm`.

The root is that every one of these values is defensible on its own and none of
them *means* anything. A rider does not see eighteen border alphas; they see a
screen where nothing looks deliberate.

## The finding that ties #613 to #621

Computing every white-family theme's zone contrast against both its surfaces:

| theme | surface | raised | binding | z3 | z4 | z5 | z6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| outrun-day | `#f6f2fa` L .967 | `#ffffff` L 1.000 | surface | 3.40 | 2.91 | 2.74 | 3.68 |
| tron-day | `#f0f4fc` L .966 | `#ffffff` L 1.000 | surface | 3.41 | 2.91 | 2.74 | 3.69 |
| miami-day | `#ecf6f7` L .966 | `#ffffff` L 1.000 | surface | 3.41 | 2.92 | 2.74 | 3.70 |
| laser-day | `#f5f3fb` L .968 | `#ffffff` L 1.000 | surface | 3.41 | 2.92 | 2.74 | 3.70 |
| monokai-day | `#f8efe7` L .957 | `#e0dad9` L .893 | raised | 2.72 | 2.61 | 2.64 | 2.95 |

Two things follow.

**`raised = #ffffff` is not a stylistic choice in four of these themes; it is
the only way the shared ramp clears its floor.** White is the furthest
background from every zone colour. Outrun Day's own z4 and z5 sit at 2.91 and
2.74 against its page — under the 3:1 accent floor — and pass only because
`zoneFloor` scales to `worst(ref) × 0.95` and the reference *is* Outrun Day.
The white family has no headroom.

**So separating the layers and keeping zones legible are in direct
competition**, because both are bought with the same currency: lightness
distance. Monokai Day spent it on separation and the gate charged it four
entries in `EXCEPTIONS`, the first of which states the finding verbatim —
*"surface-raised is close in lightness to surface by design."*

The gate is not measuring the wrong thing. It has no opinion about layer
separation at all, so design solved separation with the one variable the gate
constrains, because the app had nothing else: no shadow anywhere, and an edge
token used seven times.

## Decision

**Depth is carried by a boundary — an edge and a shadow — not by a lightness
step.** Lightness may reinforce it where a family has room to spare, and in the
cave it still does most of the work. On paper it does none, because paper has
none to spend.

Four consequences, all in `web/src/app.css`:

1. **The surface ladder gets its missing rungs.** `--color-surface-sunken` is
   the well inside a raised thing; `--color-surface-overlay` is what floats
   above the page. Both are *derived from* the existing pair rather than added
   to `TOKENS`, so every theme gains them without widening what the gate must
   hold legible. The page background stops being a component colour.
2. **Three edge weights, one job each.** `--color-edge-subtle` divides within
   one surface; `--color-edge` outlines a raised thing; `--color-edge-strong`
   outlines something the rider acts on, and has to be findable at arm's length
   while pedalling. A border now says what it separates.
3. **Elevation exists, and is deliberately asymmetric between the families.**
   `--shadow-raised` and `--shadow-overlay` share their geometry and flip only
   their ink. In the cave, near-nothing — the lightness step already carries
   depth. On paper, the whole job. This is the same `light-dark()` idiom as
   `glow-*`, inverted: each family's tool is quiet where the other's works.
4. **The small-text band is named.** `--text-micro` (10px), `--text-mini`
   (11px) and `--text-meta` (13px) sit below `text-xs`, so the five sizes doing
   "small" have somewhere to mean something.

## What this does not decide

- **The zone ramp and the gate's floors are untouched.** ADR-0023 §4 stands;
  the ramp stays shared and not themed.
- **`EXCEPTIONS` is not emptied here.** With elevation available, a theme has a
  legal way to be visibly layered without spending lightness, so the entries
  become removable — but removing them means re-deriving Monokai Day's surfaces
  and that is [#620](https://github.com/natrontech/wattroom/issues/620)'s
  successor's work, not this one's.
- **The gate does not yet check that separation exists.** It should, satisfiable
  by edge contrast *or* lightness distance, so a theme cannot ship two layers a
  rider cannot tell apart. Cut as its own issue.
- **Spacing is diagnosed, not fixed.** `p-3`/`p-4`/`p-5`/`p-6` all do "card
  padding" and `gap-2`/`gap-3` split near-evenly for the same job across ~500
  call sites. The remedy is semantic naming plus a sweep, and it is too large to
  ride along here.
- **The call sites are not swept.** `panel`, `input`, `btn-secondary` and
  `eyebrow` moved onto the new tokens; the ~370 hand-written borders and 419
  arbitrary type sizes are follow-up work per area.

## Consequences

A theme author gains a way to make layers visible that does not cost the ramp
its contrast, which is what
[#620](https://github.com/natrontech/wattroom/issues/620) ran into and what
`EXCEPTIONS` currently absorbs. A component author gains a surface for the
recess they were spelling `bg-surface`, and an edge that states its job.

The risk is the ordinary one for a token change: `panel` now paints a shadow on
111 call sites at once, and any of them that was already compensating for its
absence will now have two. That is visible, cheap to fix, and preferable to the
alternative of introducing the model beside the old one.
